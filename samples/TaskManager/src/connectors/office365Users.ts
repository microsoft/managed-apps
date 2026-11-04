import { Office365UsersService } from "../../generated";
import type { ConnectorResult } from "./result";

/**
 * Office 365 Users adapter (connector api-id `shared_office365users`): the
 * signed-in profile and profile photos.
 */

export interface UserProfile {
  id?: string;
  displayName?: string;
  mail?: string;
  userPrincipalName?: string;
}

export interface PhotoMetadata {
  HasPhoto?: boolean;
  ContentType?: string;
}

export interface Office365UsersConnector {
  myProfile(select: string): Promise<ConnectorResult<UserProfile>>;
  photoMetadata(identity: string): Promise<ConnectorResult<PhotoMetadata>>;
  /** Base64 photo content (occasionally already a data URL). */
  photo(identity: string): Promise<ConnectorResult<string>>;
}

export function createOffice365UsersConnector(): Office365UsersConnector {
  return {
    myProfile: (select) => Office365UsersService.MyProfile_V2(select),
    photoMetadata: (identity) => Office365UsersService.UserPhotoMetadata(identity),
    photo: (identity) => Office365UsersService.UserPhoto(identity),
  };
}
