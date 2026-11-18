import { eitherLanguage } from '~/lib/localized';

export const LINK_SHARED_FIELDS = {
    en: 'name, photo, masked email, group and team title, membership, event staff roles, any ban and when it ends, and any deletion date',
    zh: '名称、头像、打码的邮箱、组别与团队头衔、会员状态、活动工作人员身份、封禁状态及截止时间，以及预定删除时间',
} as const;

export const LINK_UNDO_DAYS = 7;

export const LINK_HOLD_DAYS = 30;

export const linkSharedFields = (isEnglish: boolean): string =>
    isEnglish ? LINK_SHARED_FIELDS.en : LINK_SHARED_FIELDS.zh;

export const appNameIn = (app: {nameEn: string; nameCn: string}, appId: string, isEnglish: boolean): string =>
    eitherLanguage(isEnglish, app.nameEn, app.nameCn) || appId;

export const APP_PLATFORMS = ['wechat-mini-program'] as const;
export type AppPlatform = typeof APP_PLATFORMS[number] | '';

export const APP_PLATFORM_NAMES: Record<AppPlatform, {en: string; zh: string}> = {
    '': {en: 'Other', zh: '其他'},
    'wechat-mini-program': {en: 'WeChat mini program', zh: '微信小程序'},
};
