interface ImportMetaEnv {
	readonly PUBLIC_CLOUDINARY_NAME: string;
    readonly CLOUDINARY_API_KEY: string;
    readonly CLOUDINARY_API_SECRET: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
