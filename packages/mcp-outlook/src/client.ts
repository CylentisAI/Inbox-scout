import { ConfidentialClientApplication } from '@azure/msal-node';
import fetch from 'node-fetch';

export interface EmailMessage {
  id: string;
  subject: string;
  body: string;
  from: {
    emailAddress: {
      address: string;
      name: string;
    };
  };
  conversationId: string;
  webLink: string;
  receivedDateTime: string;
}

export interface DraftResult {
  id: string;
  webLink: string;
}

export class MCPOutlookClient {
  private msalInstance: ConfidentialClientApplication;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(
    private tenantId: string,
    private clientId: string,
    private clientSecret: string
  ) {
    this.msalInstance = new ConfidentialClientApplication({
      auth: {
        clientId: this.clientId,
        clientSecret: this.clientSecret,
        authority: `https://login.microsoftonline.com/${this.tenantId}`,
      },
    });
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

    if (!response.ok) {
      throw new Error(`Graph API request failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async getUnreadMessages(): Promise<EmailMessage[]> {
    try {
      const result = await this.makeGraphRequest(
        `/users/${process.env.CLIENT_EMAIL || 'amy@alignedtribe.com'}/messages?$filter=isRead eq false&$select=id,subject,body,from,conversationId,webLink,receivedDateTime`
      );

      return result.value.map((msg: any) => ({
        id: msg.id,
        subject: msg.subject,
        body: msg.body?.content || '',
        from: {
          emailAddress: {
            address: msg.from?.emailAddress?.address || '',
            name: msg.from?.emailAddress?.name || '',
          },
        },
        conversationId: msg.conversationId,
        webLink: msg.webLink,
        receivedDateTime: msg.receivedDateTime,
      }));
    } catch (error) {
      console.error('Error fetching unread messages:', error);
      throw error;
    }
  }

  async getMessage(messageId: string): Promise<EmailMessage> {
    try {
      const msg = await this.makeGraphRequest(
        `/users/${process.env.CLIENT_EMAIL || 'amy@alignedtribe.com'}/messages/${messageId}`
      );

      return {
        id: msg.id,
        subject: msg.subject,
        body: msg.body?.content || '',
        from: {
          emailAddress: {
            address: msg.from?.emailAddress?.address || '',
            name: msg.from?.emailAddress?.name || '',
          },
        },
        conversationId: msg.conversationId,
        webLink: msg.webLink,
        receivedDateTime: msg.receivedDateTime,
      };
    } catch (error) {
      console.error(`Error fetching message ${messageId}:`, error);
      throw error;
    }
  }

  async createReplyDraft(messageId: string, replyText: string): Promise<DraftResult> {
    try {
      const draft = await this.makeGraphRequest(
        `/users/${process.env.CLIENT_EMAIL || 'amy@alignedtribe.com'}/messages/${messageId}/createReply`,
        {
          method: 'POST',
          body: JSON.stringify({
            message: {
              body: {
                contentType: 'HTML',
                content: `<div>${replyText.replace(/\n/g, '<br>')}</div>`
              }
            }
          })
        }
      );

      return {
        id: draft.id,
        webLink: draft.webLink,
      };
    } catch (error) {
      console.error(`Error creating reply draft for ${messageId}:`, error);
      throw error;
    }
  }

  async sendMail(to: string, subject: string, body: string): Promise<void> {
    try {
      await this.makeGraphRequest(
        `/users/${process.env.CLIENT_EMAIL || 'amy@alignedtribe.com'}/sendMail`,
        {
          method: 'POST',
          body: JSON.stringify({
            message: {
              subject: subject,
              body: {
                contentType: 'HTML',
                content: body
              },
              toRecipients: [
                {
                  emailAddress: {
                    address: to
                  }
                }
              ]
            }
          })
        }
      );
    } catch (error) {
      console.error('Error sending mail:', error);
      throw error;
    }
  }

  async getMessageLink(messageId: string): Promise<string> {
    try {
      const message = await this.getMessage(messageId);
      return message.webLink;
    } catch (error) {
      console.error(`Error getting message link for ${messageId}:`, error);
      throw error;
    }
  }
}