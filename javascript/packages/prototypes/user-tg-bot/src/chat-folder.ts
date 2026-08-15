import { Api, type TelegramClient } from "teleproto";

type CustomFolder = Api.DialogFilter | Api.DialogFilterChatlist;

/** The "All Chats" pseudo folder carries no title, id or peers — skip it. */
const isCustomFolder = (filter: Api.TypeDialogFilter): filter is CustomFolder => {
  return !(filter instanceof Api.DialogFilterDefault);
};

const SENATE_CHAT_FOLDER_ID = 5;
const SENATE_CHAT_FOLDER_TITLE = "Senate";

const findChatFolder = async (client: TelegramClient, id: number, text: string): Promise<CustomFolder | null> => {
  const { filters } = await client.invoke(new Api.messages.GetDialogFilters());
  const folders = filters.filter(isCustomFolder);

  if (folders.length === 0) {
    return null;
  }

  return folders.find((it) => it.id === id || it.title.text === text) || null;
};

const primaryAlgo = async (client: TelegramClient): Promise<void> => {
  const senateFolder = await findChatFolder(client, SENATE_CHAT_FOLDER_ID, SENATE_CHAT_FOLDER_TITLE);
  if (!senateFolder) {
    console.error("Senate folder not found");
    return;
  }

  // TODO;
  // const chats = ;
}

export { primaryAlgo };
