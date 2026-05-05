interface ImportMetaEnv {
	readonly PUBLIC_CLOUDINARY_CLOUD_NAME: string;
	readonly PUBLIC_CLOUDINARY_API_KEY: string;
	readonly CLOUDINARY_API_SECRET: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
