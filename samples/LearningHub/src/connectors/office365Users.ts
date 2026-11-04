import { Office365UsersService } from '../../generated/services/Office365UsersService';
import type { DirectoryUser, UsersDirectory } from './users';

/**
 * Office 365 Users connector adapter. This folder is the only place that imports `generated/`
 * (created by `npx ms app add data-source --connector shared_office365users --as action`).
 */

const PROFILE_FIELDS = 'id,displayName,mail,jobTitle';

function failure(action: string, error: { message?: string } | undefined): Error {
  return new Error(`${action}: ${error?.message || 'The connector request failed.'}`);
}

function toUser(data: { id?: string; displayName?: string; jobTitle?: string; mail?: string } | undefined): DirectoryUser {
  return {
    id: data?.id ?? '',
    displayName: data?.displayName || 'Unknown person',
    jobTitle: data?.jobTitle || undefined,
    mail: data?.mail || undefined,
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

function toImageDataUrl(value: unknown, contentType = 'image/jpeg'): string {
  if (value instanceof Uint8Array) return `data:${contentType};base64,${bytesToBase64(value)}`;
  if (value instanceof ArrayBuffer) return `data:${contentType};base64,${bytesToBase64(new Uint8Array(value))}`;
  if (typeof value === 'string') {
    if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(value)) return value;
    if (/^[a-z]+:/i.test(value)) throw new Error('The profile photo response was a URL instead of image data.');
    return `data:${contentType};base64,${value}`;
  }
  throw new Error('The profile photo response used an unsupported format.');
}

export const office365Users: UsersDirectory = {
  async getMe() {
    const result = await Office365UsersService.MyProfile_V2(PROFILE_FIELDS);
    if (!result.success) throw failure('Couldn’t load your profile', result.error);
    const me = toUser(result.data);
    if (!me.id) throw new Error('Your profile has no directory id.');
    return me;
  },

  async getUser(id) {
    const result = await Office365UsersService.UserProfile_V2(id, PROFILE_FIELDS);
    if (!result.success) throw failure('Couldn’t look up this person', result.error);
    return toUser(result.data);
  },

  async getPhoto(id) {
    const metadata = await Office365UsersService.UserPhotoMetadata(id);
    if (!metadata.success) throw failure('Couldn’t check the profile photo', metadata.error);
    if (!metadata.data?.HasPhoto) return null;
    const photo = await Office365UsersService.UserPhoto_V2(id);
    if (!photo.success) throw failure('Couldn’t load the profile photo', photo.error);
    return photo.data ? toImageDataUrl(photo.data, metadata.data.ContentType || undefined) : null;
  },

  async searchUsers(term, limit) {
    const result = await Office365UsersService.SearchUserV2(term, limit, true);
    if (!result.success) throw failure('Couldn’t search people', result.error);
    const seen = new Set<string>();
    const people: DirectoryUser[] = [];
    for (const user of result.data?.value ?? []) {
      if (!user.Id || seen.has(user.Id)) continue;
      seen.add(user.Id);
      people.push({
        id: user.Id,
        displayName: user.DisplayName || user.Mail || 'Unknown person',
        jobTitle: user.JobTitle || undefined,
        mail: user.Mail || undefined,
      });
    }
    return people;
  },
};
