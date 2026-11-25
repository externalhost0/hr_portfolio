#!/usr/bin/env node
// usage: npm run posts -- add <tweet url or id> [--media N]
//        re-adding an existing post keeps its position and caption and re-downloads missing media
//        npm run posts -- remove <key>
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataFile = join(root, "src/data/posts.json");
const mediaDir = join(root, "src/assets/posts");

const readPosts = async () => {
	try {
		return JSON.parse(await readFile(dataFile, "utf8"));
	} catch (error) {
		if (error.code === "ENOENT") return [];
		throw error;
	}
};

const writePosts = async (posts) => {
	await mkdir(dirname(dataFile), { recursive: true });
	await writeFile(dataFile, JSON.stringify(posts, null, "\t") + "\n");
};

const exists = (path) => stat(path).then(() => true, () => false);

const parseId = (input) => {
	const match = String(input).match(/status\/(\d+)/) ?? String(input).match(/^(\d+)$/);
	if (!match) throw new Error(`cannot find a tweet id in "${input}"`);
	return match[1];
};

const fetchTweet = async (id) => {
	const token = ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
	const res = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}`);
	if (!res.ok) throw new Error(`syndication returned ${res.status} for ${id}`);
	const type = res.headers.get("content-type") ?? "";
	if (!type.includes("json")) throw new Error(`tweet ${id} is not available (deleted or private)`);
	const tweet = await res.json();
	if (tweet.__typename === "TweetTombstone") throw new Error(`tweet ${id} is a tombstone`);
	return tweet;
};

const pickVariant = (variants) => {
	const mp4s = variants.filter((v) => v.content_type === "video/mp4");
	if (!mp4s.length) throw new Error("tweet has no mp4 variant");
	return mp4s.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
};

const download = async (url, dest) => {
	const res = await fetch(url);
	if (!res.ok || !res.body) throw new Error(`download failed (${res.status}): ${url}`);
	await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
};

const cleanText = (tweet) => {
	const [start, end] = tweet.display_text_range ?? [0, tweet.text.length];
	return [...tweet.text].slice(start, end).join("").replace(/https:\/\/t\.co\/\w+/g, "").trim();
};

const add = async (input, mediaIndex) => {
	const id = parseId(input);
	const key = mediaIndex > 1 ? `${id}-${mediaIndex}` : id;
	const tweet = await fetchTweet(id);
	const media = tweet.mediaDetails?.[mediaIndex - 1];
	if (!media) throw new Error(`tweet ${id} has no media #${mediaIndex}`);

	await mkdir(mediaDir, { recursive: true });
	const isVideo = media.type === "video" || media.type === "animated_gif";
	const imageDest = join(mediaDir, `${key}.jpg`);
	if (!(await exists(imageDest))) await download(`${media.media_url_https}?name=large&format=jpg`, imageDest);
	if (isVideo) {
		const videoDest = join(mediaDir, `${key}.mp4`);
		if (!(await exists(videoDest))) await download(pickVariant(media.video_info.variants).url, videoDest);
	}

	const entry = {
		key,
		url: `https://x.com/${tweet.user.screen_name}/status/${id}`,
		author: tweet.user.screen_name,
		date: tweet.created_at,
		text: cleanText(tweet),
		kind: isVideo ? "video" : "image",
		width: media.original_info.width,
		height: media.original_info.height,
	};

	const posts = await readPosts();
	const at = posts.findIndex((p) => p.key === key);
	if (at === -1) {
		await writePosts([entry, ...posts]);
	} else {
		posts[at] = { ...entry, text: posts[at].text };
		await writePosts(posts);
	}
	console.log(`added ${key} (${entry.kind}, ${entry.width}x${entry.height}): ${entry.text.slice(0, 60)}`);
};

const remove = async (key) => {
	const posts = await readPosts();
	if (!posts.some((p) => p.key === key)) throw new Error(`no post with key "${key}"`);
	await writePosts(posts.filter((p) => p.key !== key));
	await Promise.all([".jpg", ".mp4"].map((ext) => rm(join(mediaDir, key + ext), { force: true })));
	console.log(`removed ${key}`);
};

const [command, target, ...rest] = process.argv.slice(2);
try {
	if (command === "add" && target) {
		const flag = rest.indexOf("--media");
		await add(target, flag === -1 ? 1 : Number(rest[flag + 1]));
	} else if (command === "remove" && target) {
		await remove(target);
	} else {
		console.log("usage: npm run posts -- add <tweet url or id> [--media N]\n       npm run posts -- remove <key>");
		process.exitCode = 1;
	}
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
}
