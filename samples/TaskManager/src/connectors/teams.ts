import { MicrosoftTeamsService } from "../../generated";
import type { ConnectorResult } from "./result";

/**
 * Teams adapter (connector api-id `shared_teams`). The app only posts a chat
 * message from the connector's bot to one person.
 */
export interface TeamsConnector {
  /** Sends an HTML message to `recipient` (an email/UPN) in a 1:1 chat with the bot. */
  postChatMessage(recipient: string, messageHtml: string): Promise<ConnectorResult<void>>;
}

// Values the connector expects for "post as the bot, in a chat with the bot".
const POSTER = "Flow bot";
const LOCATION = "Chat with Flow bot";

export function createTeamsConnector(): TeamsConnector {
  return {
    postChatMessage: (recipient, messageHtml) =>
      MicrosoftTeamsService.PostMessageToConversation(POSTER, LOCATION, {
        recipient,
        messageBody: messageHtml,
      }),
  };
}
