/**
 * What an app an account is linked in reads of it, as Settings and the Apps
 * tool put it. A copy of LINK_SHARED_FIELDS in functions/src/utils/appLinks.ts,
 * which the emails use: change all three together, and the API's linkJson
 * with them.
 */
export const LINK_SHARED_FIELDS = {
    en: 'name, photo, masked email, group and team title, membership, event staff roles, any ban and when it ends, and any deletion date',
    zh: '名称、头像、打码的邮箱、组别与团队头衔、会员状态、活动工作人员身份、封禁状态及截止时间，以及预定删除时间',
} as const;

export const linkSharedFields = (isEnglish: boolean): string =>
    isEnglish ? LINK_SHARED_FIELDS.en : LINK_SHARED_FIELDS.zh;

/**
 * What an app runs on, for Settings to show it by. A copy of APP_PLATFORMS in
 * functions/src/utils/apps.ts: change both together.
 */
export const APP_PLATFORMS = ['wechat-mini-program'] as const;
export type AppPlatform = typeof APP_PLATFORMS[number] | '';

/** Each platform's name, for the Apps tool's choice and Settings' line under an app's name. */
export const APP_PLATFORM_NAMES: Record<AppPlatform, {en: string; zh: string}> = {
    '': {en: 'Other', zh: '其他'},
    'wechat-mini-program': {en: 'WeChat mini program', zh: '微信小程序'},
};
