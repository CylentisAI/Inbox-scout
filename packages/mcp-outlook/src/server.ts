import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { ConfidentialClientApplication } from '@azure/msal-node';
import fetch from 'node-fetch';

interface OutlookMessage {
  id: string;
  subject: string;
  body: {
    content: string;
    contentType: string;
  };
  from: {
    emailAddress: {
      address: string;
      name: string;
    };
  };
  toRecipients: Array<{
    emailAddress: {
      address: string;
      name: string;
    };
  }>;
  conversationId: string;
  webLink: string;
  receivedDateTime: string;
  isRead: boolean;
}

interface OutlookDraft {
  id: string;
  subject: string;
  body: {
    content: string;
    contentType: string;
  };
  webLink: string;
  conversationId: string;
}

class OutlookGraphClient {
  private msalInstance: ConfidentialClientApplication;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(
    private clientId: string,
    private clientSecret: string,
    private tenantId: string
  ) {
    const msalConfig = {
      auth: {
        clientId: this.clientId,
        clientSecret: this.clientSecret,
        authority: `https://login.microsoftonline.com/${this.tenantId}`,
      },
    };
    this.msalInstance = new ConfidentialClientApplication(msalConfig);
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    try {
      const clientCredentialRequest = {
        scopes: ['https://graph.microsoft.com/.default'],
      };

      const response = await this.msalInstance.acquireTokenByClientCredential(
        clientCredentialRequest
      );

      if (!response || !response.accessToken) {
        throw new Error('Failed to acquire access token: no response or token');
      }

      this.accessToken = response.accessToken;
      this.tokenExpiry = Date.now() + (response.expiresOn?.getTime() || 0) - 60000; // 1 min buffer
      
      return this.accessToken;
    } catch (error) {
      throw new Error(`Failed to acquire access token: ${error}`);
    }
  }

  private async makeGraphRequest(endpoint: string, options: any = {}): Promise<any> {
    const token = await this.getAccessToken();
    
    const response = await fetch(`https://graph.microsoft.com/v1.0${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response || !response.ok) {
      throw new Error(`Graph API request failed: ${response?.status} ${response?.statusText}`);
    }

    return response.json();
  }

  async getUnreadMessages(limit: number = 50): Promise<OutlookMessage[]> {
    const response = await this.makeGraphRequest(
      `/me/messages?$filter=isRead eq false&$top=${limit}&$orderby=receivedDateTime desc`
    );
    
    return response.value.map((msg: any) => ({
      id: msg.id,
      subject: msg.subject,
      body: {
        content: msg.body.content,
        contentType: msg.body.contentType,
      },
      from: msg.from,
      toRecipients: msg.toRecipients,
      conversationId: msg.conversationId,
      webLink: msg.webLink,
      receivedDateTime: msg.receivedDateTime,
      isRead: msg.isRead,
    }));
  }

  async getMessage(messageId: string, preferText: boolean = true): Promise<OutlookMessage> {
    const headers = preferText ? {
      'Prefer': 'outlook.body-content-type="text"'
    } : {};

    const msg = await this.makeGraphRequest(`/me/messages/${messageId}`, { headers });
    
    return {
      id: msg.id,
      subject: msg.subject,
      body: {
        content: msg.body.content,
        contentType: msg.body.contentType,
      },
      from: msg.from,
      toRecipients: msg.toRecipients,
      conversationId: msg.conversationId,
      webLink: msg.webLink,
      receivedDateTime: msg.receivedDateTime,
      isRead: msg.isRead,
    };
  }

  async createReplyDraft(messageId: string): Promise<string> {
    const response = await this.makeGraphRequest(
      `/me/messages/${messageId}/createReply`,
      { method: 'POST' }
    );
    
    return response.id;
  }

  async updateDraft(draftId: string, subject?: string, bodyHtml?: string): Promise<void> {
    const updateData: any = {};
    
    if (subject) {
      updateData.subject = subject;
    }
    
    if (bodyHtml) {
      updateData.body = {
        contentType: 'HTML',
        content: bodyHtml,
      };
    }

    await this.makeGraphRequest(`/me/messages/${draftId}`, {
      method: 'PATCH',
      body: JSON.stringify(updateData),
    });
  }

  async getMessageLink(messageId: string): Promise<string> {
    const msg = await this.makeGraphRequest(`/me/messages/${messageId}`);
    return msg.webLink;
  }

  async sendDigest(to: string, subject: string, htmlBody: string): Promise<void> {
    const message = {
      message: {
        subject: subject,
        body: {
          contentType: 'HTML',
          content: htmlBody,
        },
        toRecipients: [
          {
            emailAddress: {
              address: to,
            },
          },
        ],
      },
    };

    await this.makeGraphRequest('/me/sendMail', {
      method: 'POST',
      body: JSON.stringify(message),
    });
  }

  async markAsRead(messageId: string): Promise<void> {
    await this.makeGraphRequest(`/me/messages/${messageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ isRead: true }),
    });
  }
}

class OutlookMCPServer {
  private server: Server;
  private graphClient: OutlookGraphClient;

  constructor() {
    this.server = new Server({
      name: 'outlook-mcp',
      version: '1.0.0',
    });

    // Initialize Graph client with environment variables
    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = process.env.AZURE_CLIENT_SECRET;
    const tenantId = process.env.AZURE_TENANT_ID;

    if (!clientId || !clientSecret || !tenantId) {
      throw new Error('Missing required environment variables: AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_TENANT_ID');
    }

    this.graphClient = new OutlookGraphClient(clientId, clientSecret, tenantId);
    this.setupToolHandlers();
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'get_unread_messages',
            description: 'Get unread emails from Outlook inbox',
            inputSchema: {
              type: 'object',
              properties: {
                limit: {
                  type: 'number',
                  description: 'Maximum number of messages to retrieve',
                  default: 50,
                },
              },
            },
          },
          {
            name: 'get_message',
            description: 'Get a specific email message by ID',
            inputSchema: {
              type: 'object',
              properties: {
                messageId: {
                  type: 'string',
                  description: 'The message ID to retrieve',
                },
                preferText: {
                  type: 'boolean',
                  description: 'Whether to prefer text content over HTML',
                  default: true,
                },
              },
              required: ['messageId'],
            },
          },
          {
            name: 'create_reply_draft',
            description: 'Create a reply draft for a message',
            inputSchema: {
              type: 'object',
              properties: {
                messageId: {
                  type: 'string',
                  description: 'The message ID to reply to',
                },
              },
              required: ['messageId'],
            },
          },
          {
            name: 'update_draft',
            description: 'Update a draft message with new content',
            inputSchema: {
              type: 'object',
              properties: {
                draftId: {
                  type: 'string',
                  description: 'The draft ID to update',
                },
                subject: {
                  type: 'string',
                  description: 'New subject line',
                },
                bodyHtml: {
                  type: 'string',
                  description: 'New HTML body content',
                },
              },
              required: ['draftId'],
            },
          },
          {
            name: 'get_message_link',
            description: 'Get the web link for a message',
            inputSchema: {
              type: 'object',
              properties: {
                messageId: {
                  type: 'string',
                  description: 'The message ID to get the link for',
                },
              },
              required: ['messageId'],
            },
          },
          {
            name: 'send_digest',
            description: 'Send a digest email',
            inputSchema: {
              type: 'object',
              properties: {
                to: {
                  type: 'string',
                  description: 'Recipient email address',
                },
                subject: {
                  type: 'string',
                  description: 'Email subject',
                },
                htmlBody: {
                  type: 'string',
                  description: 'HTML email body',
                },
              },
              required: ['to', 'subject', 'htmlBody'],
            },
          },
          {
            name: 'mark_as_read',
            description: 'Mark a message as read',
            inputSchema: {
              type: 'object',
              properties: {
                messageId: {
                  type: 'string',
                  description: 'The message ID to mark as read',
                },
              },
              required: ['messageId'],
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'get_unread_messages':
            const limit = (args as any)?.limit || 50;
            const messages = await this.graphClient.getUnreadMessages(limit);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(messages, null, 2),
                },
              ],
            };

          case 'get_message':
            const message = await this.graphClient.getMessage(
              (args as any)?.messageId, 
              (args as any)?.preferText
            );
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(message, null, 2),
                },
              ],
            };

          case 'create_reply_draft':
            const draftId = await this.graphClient.createReplyDraft((args as any)?.messageId);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ draftId }, null, 2),
                },
              ],
            };

          case 'update_draft':
            await this.graphClient.updateDraft(
              (args as any)?.draftId, 
              (args as any)?.subject, 
              (args as any)?.bodyHtml
            );
            return {
              content: [
                {
                  type: 'text',
                  text: 'Draft updated successfully',
                },
              ],
            };

          case 'get_message_link':
            const webLink = await this.graphClient.getMessageLink((args as any)?.messageId);
            return {
              content: [
                {
                  type: 'text',
                  text: webLink,
                },
              ],
            };

          case 'send_digest':
            await this.graphClient.sendDigest(
              (args as any)?.to, 
              (args as any)?.subject, 
              (args as any)?.htmlBody
            );
            return {
              content: [
                {
                  type: 'text',
                  text: 'Digest sent successfully',
                },
              ],
            };

          case 'mark_as_read':
            await this.graphClient.markAsRead((args as any)?.messageId);
            return {
              content: [
                {
                  type: 'text',
                  text: 'Message marked as read',
                },
              ],
            };

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${error}`
        );
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Outlook MCP server running on stdio');
  }
}

// Start the server
const server = new OutlookMCPServer();
server.run().catch(console.error);
