import { Context, Schema, Service } from 'koishi';
export declare const name = "fonts";
export declare const inject: {
    required: any[];
    optional: any[];
};
declare const fontSchemaOptions: Schema<string, string>[];
export { fontSchemaOptions as fontlist };
interface FontInfo {
    name: string;
    dataUrl: string;
    format: string;
    size: number;
}
declare module 'koishi' {
    interface Context {
        fonts: FontsService;
    }
}
export declare class FontsService extends Service {
    config: FontsService.Config;
    private fontMap;
    private fontRoot;
    constructor(ctx: Context, config: FontsService.Config);
    start(): Promise<void>;
    private loadFonts;
    private getMimeType;
    getFontInfo(name: string): FontInfo | undefined;
    getFontNames(): string[];
    getFontDataUrl(name: string): string | undefined;
}
export declare namespace FontsService {
    interface Config {
        root: string;
    }
    const Config: Schema<Config>;
}
export declare const Config: Schema<FontsService.Config>;
export declare function apply(ctx: Context, config: FontsService.Config): void;
