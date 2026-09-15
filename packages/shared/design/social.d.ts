/** Types for the social-platform registry. The `host` pattern is what stops a
 *  platform glyph in a tenant's footer pointing anywhere at all. */
export type SocialPlatform = {
  id: string;
  name: string;
  icon: string;
  host: RegExp;
  placeholder: string;
};

export declare const SOCIAL_PLATFORMS: SocialPlatform[];
export declare const SOCIAL_IDS: string[];
export declare function socialById(id: string): SocialPlatform | null;
export declare function isValidSocialUrl(id: string, url: string): boolean;
