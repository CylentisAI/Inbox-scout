import { Client } from '@notionhq/client';

export interface NotionDatabaseIds {
  contacts: string;
  drafts: string;
  interactions: string;
  knowledgeBase: string;
  voicePack: string;
}

export interface Contact {
  email: string;
  name: string;
  lastInteraction: string;
}

export interface Draft {
  messageId: string;
  subject: string;
  from: string;
  draftText: string;
  voiceScore: number;
  status: string;
  createdAt: string;
}

export interface Interaction {
  messageId: string;
  subject: string;
  from: string;
  timestamp: string;
  status: string;
  draftId?: string;
  voiceScore?: number;
}

export class MCPNotionClient {
  private notion: Client;
  private databaseIds: NotionDatabaseIds;

  constructor(apiKey: string, databaseIds: NotionDatabaseIds) {
    this.notion = new Client({ auth: apiKey });
    this.databaseIds = databaseIds;
  }

  async findOrCreateContact(contact: Contact): Promise<any> {
    try {
      // First, try to find existing contact
      const existing = await this.notion.databases.query({
        database_id: this.databaseIds.contacts,
        filter: {
          property: 'Email',
          rich_text: {
            equals: contact.email
          }
        }
      });

      if (existing.results.length > 0) {
        // Update last interaction
        await this.notion.pages.update({
          page_id: existing.results[0].id,
          properties: {
            'Last Interaction': {
              date: {
                start: contact.lastInteraction
              }
            }
          }
        });
        return existing.results[0];
      }

      // Create new contact
      const newContact = await this.notion.pages.create({
        parent: { database_id: this.databaseIds.contacts },
        properties: {
          'Name': {
            title: [
              {
                text: {
                  content: contact.name
                }
              }
            ]
          },
          'Email': {
            rich_text: [
              {
                text: {
                  content: contact.email
                }
              }
            ]
          },
          'Last Interaction': {
            date: {
              start: contact.lastInteraction
            }
          }
        }
      });

      return newContact;
    } catch (error) {
      console.error('Error finding/creating contact:', error);
      throw error;
    }
  }

  async createDraft(draft: Draft): Promise<any> {
    try {
      const newDraft = await this.notion.pages.create({
        parent: { database_id: this.databaseIds.drafts },
        properties: {
          'Subject': {
            title: [
              {
                text: {
                  content: draft.subject
                }
              }
            ]
          },
          'From': {
            rich_text: [
              {
                text: {
                  content: draft.from
                }
              }
            ]
          },
          'Message ID': {
            rich_text: [
              {
                text: {
                  content: draft.messageId
                }
              }
            ]
          },
          'Draft Text': {
            rich_text: [
              {
                text: {
                  content: draft.draftText
                }
              }
            ]
          },
          'Voice Score': {
            number: draft.voiceScore
          },
          'Status': {
            select: {
              name: draft.status
            }
          },
          'Created At': {
            date: {
              start: draft.createdAt
            }
          }
        }
      });

      return newDraft;
    } catch (error) {
      console.error('Error creating draft:', error);
      throw error;
    }
  }

  async createInteraction(interaction: Interaction): Promise<any> {
    try {
      const newInteraction = await this.notion.pages.create({
        parent: { database_id: this.databaseIds.interactions },
        properties: {
          'Subject': {
            title: [
              {
                text: {
                  content: interaction.subject
                }
              }
            ]
          },
          'From': {
            rich_text: [
              {
                text: {
                  content: interaction.from
                }
              }
            ]
          },
          'Message ID': {
            rich_text: [
              {
                text: {
                  content: interaction.messageId
                }
              }
            ]
          },
          'Status': {
            select: {
              name: interaction.status
            }
          },
          'Timestamp': {
            date: {
              start: interaction.timestamp
            }
          },
          'Voice Score': {
            number: interaction.voiceScore || 0
          }
        }
      });

      return newInteraction;
    } catch (error) {
      console.error('Error creating interaction:', error);
      throw error;
    }
  }

  async findContact(email: string): Promise<any> {
    try {
      const result = await this.notion.databases.query({
        database_id: this.databaseIds.contacts,
        filter: {
          property: 'Email',
          rich_text: {
            equals: email
          }
        }
      });

      return result.results.length > 0 ? result.results[0] : null;
    } catch (error) {
      console.error('Error finding contact:', error);
      throw error;
    }
  }

  async updateDraft(draftId: string, updates: Partial<Draft>): Promise<any> {
    try {
      const properties: any = {};

      if (updates.status) {
        properties['Status'] = {
          select: { name: updates.status }
        };
      }

      if (updates.voiceScore !== undefined) {
        properties['Voice Score'] = {
          number: updates.voiceScore
        };
      }

      if (updates.draftText) {
        properties['Draft Text'] = {
          rich_text: [
            {
              text: {
                content: updates.draftText
              }
            }
          ]
        };
      }

      const updatedDraft = await this.notion.pages.update({
        page_id: draftId,
        properties
      });

      return updatedDraft;
    } catch (error) {
      console.error('Error updating draft:', error);
      throw error;
    }
  }

  async getDrafts(status?: string): Promise<any[]> {
    try {
      const filter: any = {};
      
      if (status) {
        filter.property = 'Status';
        filter.select = { equals: status };
      }

      const result = await this.notion.databases.query({
        database_id: this.databaseIds.drafts,
        filter: Object.keys(filter).length > 0 ? filter : undefined
      });

      return result.results;
    } catch (error) {
      console.error('Error getting drafts:', error);
      throw error;
    }
  }

  async getInteractions(limit: number = 50): Promise<any[]> {
    try {
      const result = await this.notion.databases.query({
        database_id: this.databaseIds.interactions,
        page_size: limit
      });

      return result.results;
    } catch (error) {
      console.error('Error getting interactions:', error);
      throw error;
    }
  }
}