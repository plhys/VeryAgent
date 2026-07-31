import {
  getTransport,
} from "../transport"
import type {
  ChatChannelInfo,
  ChannelStatusInfo,
  ChatChannelMessageLog,
  WebhookConfig,
} from "../types"


export interface WebServerInfo {
  port: number
  token: string
  addresses: string[]
}


export async function startWebServer(params?: {
  port?: number
  host?: string
  token?: string | null
}): Promise<WebServerInfo> {
  return getTransport().call("start_web_server", {
    port: params?.port ?? null,
    host: params?.host ?? null,
    token: params?.token ?? null,
  })
}


export async function stopWebServer(): Promise<void> {
  return getTransport().call("stop_web_server")
}


export async function getWebServerStatus(): Promise<WebServerInfo | null> {
  return getTransport().call("get_web_server_status")
}


export interface WebServiceConfig {
  token: string | null
  port: number | null
  autoStart: boolean
}


export async function getWebServiceConfig(): Promise<WebServiceConfig> {
  return getTransport().call("get_web_service_config")
}


export async function updateWebServiceConfig(
  config: WebServiceConfig
): Promise<WebServiceConfig> {
  return getTransport().call("update_web_service_config", { config })
}


export async function listChatChannels(): Promise<ChatChannelInfo[]> {
  return getTransport().call("list_chat_channels")
}


export async function updateChatChannel(params: {
  id: number
  name?: string | null
  enabled?: boolean | null
  configJson?: string | null
  eventFilterJson?: string | null
  dailyReportEnabled?: boolean | null
  dailyReportTime?: string | null
}): Promise<ChatChannelInfo> {
  return getTransport().call("update_chat_channel", {
    id: params.id,
    name: params.name ?? null,
    enabled: params.enabled ?? null,
    configJson: params.configJson ?? null,
    eventFilterJson: params.eventFilterJson ?? null,
    dailyReportEnabled: params.dailyReportEnabled ?? null,
    dailyReportTime: params.dailyReportTime ?? null,
  })
}


export async function deleteChatChannel(id: number): Promise<void> {
  return getTransport().call("delete_chat_channel", { id })
}


export async function saveChatChannelToken(
  channelId: number,
  token: string
): Promise<void> {
  return getTransport().call("save_chat_channel_token", { channelId, token })
}


export async function getChatChannelHasToken(
  channelId: number
): Promise<boolean> {
  return getTransport().call("get_chat_channel_has_token", { channelId })
}


export async function deleteChatChannelToken(channelId: number): Promise<void> {
  return getTransport().call("delete_chat_channel_token", { channelId })
}


export async function connectChatChannel(id: number): Promise<void> {
  return getTransport().call("connect_chat_channel", { id })
}


export async function disconnectChatChannel(id: number): Promise<void> {
  return getTransport().call("disconnect_chat_channel", { id })
}


export async function testChatChannel(id: number): Promise<void> {
  return getTransport().call("test_chat_channel", { id })
}


export async function getChatChannelStatus(): Promise<ChannelStatusInfo[]> {
  return getTransport().call("get_chat_channel_status")
}


export async function listChatChannelMessages(params: {
  channelId: number
  limit?: number
  offset?: number
}): Promise<ChatChannelMessageLog[]> {
  return getTransport().call("list_chat_channel_messages", {
    channelId: params.channelId,
    limit: params.limit ?? null,
    offset: params.offset ?? null,
  })
}


export async function getChatCommandPrefix(): Promise<string> {
  return getTransport().call("get_chat_command_prefix")
}


export async function setChatCommandPrefix(prefix: string): Promise<void> {
  return getTransport().call("set_chat_command_prefix", { prefix })
}


export async function getChatEventFilter(): Promise<string[] | null> {
  return getTransport().call("get_chat_event_filter")
}


export async function setChatEventFilter(
  filter: string[] | null
): Promise<void> {
  return getTransport().call("set_chat_event_filter", { filter })
}


export async function getChatEventWebhooks(): Promise<WebhookConfig[]> {
  return getTransport().call("get_chat_event_webhooks")
}


export async function setChatEventWebhooks(
  webhooks: WebhookConfig[]
): Promise<void> {
  return getTransport().call("set_chat_event_webhooks", { webhooks })
}


export async function getChatMessageLanguage(): Promise<string> {
  return getTransport().call("get_chat_message_language")
}


export async function setChatMessageLanguage(language: string): Promise<void> {
  return getTransport().call("set_chat_message_language", { language })
}

// ─── WeChat QR Code Auth ───


export async function weixinGetQrcode(): Promise<{
  qrcode_id: string
  qrcode_img_content: string
}> {
  return getTransport().call("weixin_get_qrcode")
}


export async function weixinCheckQrcode(
  channelId: number,
  qrcode: string
): Promise<{
  status: string
}> {
  return getTransport().call("weixin_check_qrcode", { channelId, qrcode })
}

// ---------------------------------------------------------------------------
// Model Providers
// ---------------------------------------------------------------------------


