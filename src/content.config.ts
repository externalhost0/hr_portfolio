import { defineCollection } from "astro:content";
import { cldAssetsLoader } from "astro-cloudinary/loaders";

export const collections = {
	old: defineCollection({
		loader: cldAssetsLoader({
			folder: "images/oldworks/",
			limit: 120
		}),
	}),
};
