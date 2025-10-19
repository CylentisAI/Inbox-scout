import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { Client } from '@notionhq/client';

interface Contact {
  id: string;
  email: string;
  name: string;
  company?: string;
  lastInteraction?: string;
  interactionCount: number;
  notes?: string;
}

interface Draft {
  id: string;
  title: string;
  contactId: string;
  sourceMessageId: string;
  proposedReply: string;
  outlookDraftId?: string;
  outlookWebLink?: string;
  status: 'Proposed' | 'Reviewing' | 'Sent' | 'Discarded';
  priority: 'Low' | 'Medium' | 'High' | 'Urgent';
  emailType: 'Inquiry' | 'Follow-up' | 'Support' | 'Sales' | 'Other';
  wordCount: number;
  voiceScore: number;
}

interface Interaction {
  id: string;
  title: string;
  contactId: string;
  sourceMessageId: string;
  interactionType: 'Inbound' | 'Outbound' | 'Reply' | 'Follow-up' | 'Meeting' | 'Call';
  subject: string;
  summary: string;
  sentiment: 'Positive' | 'Neutral' | 'Negative' | 'Urgent';
  actionRequired: boolean;
  followUpDate?: string;
  meetingScheduled: boolean;
  outcome: 'Resolved' | 'In Progress' | 'Needs Follow-up' | 'Escalated';
  relatedDraftId?: string;
}

interface KnowledgeBase {
  id: string;
  title: string;
  content: string;
  category: 'Company Info' | 'Processes' | 'Pricing' | 'Support' | 'Sales' | 'Other';
  tags: string[];
  source: 'Manual Entry' | 'Email Extract' | 'LinkedIn' | 'Website' | 'Other';
  confidenceScore: number;
  usageCount: number;
  isActive: boolean;
}

interface VoicePack {
  id: string;
  title: string;
  content: string;
  source: 'LinkedIn Post' | 'Email Edit' | 'Manual Entry' | 'AI Generated';
  voiceElement: 'Greeting' | 'Closing' | 'Transition' | 'Question Style' | 'CTA Style';
  confidence: number;
  usageCount: number;
  isActive: boolean;
  tags: string[];
  wordCount: number;
}

class NotionClient {
  private client: Client;
  private contactsDbId: string;
  private draftsDbId: string;
  private kbDbId: string;
  private interactionsDbId: string;
  private voicePackDbId: string;

  constructor(
    apiKey: string,
    contactsDbId: string,
    draftsDbId: string,
    kbDbId: string,
    interactionsDbId: string,
    voicePackDbId: string
  ) {
    this.client = new Client({ auth: apiKey });
    this.contactsDbId = contactsDbId;
    this.draftsDbId = draftsDbId;
    this.kbDbId = kbDbId;
    this.interactionsDbId = interactionsDbId;
    this.voicePackDbId = voicePackDbId;
  }

  // Contact Operations
  async findContact(email: string): Promise<Contact | null> {
    try {
      const response = await this.client.databases.query({
        database_id: this.contactsDbId,
        filter: {
          property: 'Email',
          rich_text: {
            equals: email,
          },
        },
      });

      if (response.results.length === 0) {
        return null;
      }

      const page = response.results[0] as any;
      return this.mapContactFromPage(page);
    } catch (error) {
      throw new Error(`Failed to find contact: ${error}`);
    }
  }

  async upsertContact(contact: Partial<Contact>): Promise<Contact> {
    try {
      // Try to find existing contact
      const existing = await this.findContact(contact.email!);
      
      if (existing) {
        // Update existing contact
        const response = await this.client.pages.update({
          page_id: existing.id,
          properties: this.buildContactProperties(contact),
        });
        return this.mapContactFromPage(response as any);
      } else {
        // Create new contact
        const response = await this.client.pages.create({
          parent: { database_id: this.contactsDbId },
          properties: this.buildContactProperties(contact),
        });
        return this.mapContactFromPage(response as any);
      }
    } catch (error) {
      throw new Error(`Failed to upsert contact: ${error}`);
    }
  }

  // Draft Operations
  async createDraft(draft: Partial<Draft>): Promise<Draft> {
    try {
      const response = await this.client.pages.create({
        parent: { database_id: this.draftsDbId },
        properties: this.buildDraftProperties(draft),
      });
      return this.mapDraftFromPage(response as any);
    } catch (error) {
      throw new Error(`Failed to create draft: ${error}`);
    }
  }

  async updateDraft(draftId: string, updates: Partial<Draft>): Promise<Draft> {
    try {
      const response = await this.client.pages.update({
        page_id: draftId,
        properties: this.buildDraftProperties(updates),
      });
      return this.mapDraftFromPage(response as any);
    } catch (error) {
      throw new Error(`Failed to update draft: ${error}`);
    }
  }

  async getYesterdayDrafts(): Promise<Draft[]> {
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);

      const response = await this.client.databases.query({
        database_id: this.draftsDbId,
        filter: {
          and: [
            {
              property: 'Created Time',
              date: {
                equals: yesterday.toISOString().split('T')[0],
              },
            },
          ],
        },
      });

      return response.results.map((page: any) => this.mapDraftFromPage(page));
    } catch (error) {
      throw new Error(`Failed to get yesterday drafts: ${error}`);
    }
  }

  // Interaction Operations
  async logInteraction(interaction: Partial<Interaction>): Promise<Interaction> {
    try {
      const response = await this.client.pages.create({
        parent: { database_id: this.interactionsDbId },
        properties: this.buildInteractionProperties(interaction),
      });
      return this.mapInteractionFromPage(response as any);
    } catch (error) {
      throw new Error(`Failed to log interaction: ${error}`);
    }
  }

  // Knowledge Base Operations
  async upsertKnowledgeBase(kb: Partial<KnowledgeBase>): Promise<KnowledgeBase> {
    try {
      const response = await this.client.pages.create({
        parent: { database_id: this.kbDbId },
        properties: this.buildKnowledgeBaseProperties(kb),
      });
      return this.mapKnowledgeBaseFromPage(response as any);
    } catch (error) {
      throw new Error(`Failed to upsert knowledge base: ${error}`);
    }
  }

  async queryKnowledgeBase(query: string, limit: number = 10): Promise<KnowledgeBase[]> {
    try {
      const response = await this.client.databases.query({
        database_id: this.kbDbId,
        filter: {
          property: 'Is Active',
          checkbox: {
            equals: true,
          },
        },
      });

      // Simple text matching for now - could be enhanced with vector search
      const results = response.results
        .map((page: any) => this.mapKnowledgeBaseFromPage(page))
        .filter((kb: KnowledgeBase) => 
          kb.title.toLowerCase().includes(query.toLowerCase()) ||
          kb.content.toLowerCase().includes(query.toLowerCase())
        )
        .slice(0, limit);

      return results;
    } catch (error) {
      throw new Error(`Failed to query knowledge base: ${error}`);
    }
  }

  // Voice Pack Operations
  async upsertVoicePack(voicePack: Partial<VoicePack>): Promise<VoicePack> {
    try {
      const response = await this.client.pages.create({
        parent: { database_id: this.voicePackDbId },
        properties: this.buildVoicePackProperties(voicePack),
      });
      return this.mapVoicePackFromPage(response as any);
    } catch (error) {
      throw new Error(`Failed to upsert voice pack: ${error}`);
    }
  }

  // Helper Methods
  private buildContactProperties(contact: Partial<Contact>): any {
    const properties: any = {};
    
    if (contact.email) {
      properties['Email'] = { rich_text: [{ text: { content: contact.email } }] };
    }
    if (contact.name) {
      properties['Name'] = { title: [{ text: { content: contact.name } }] };
    }
    if (contact.company) {
      properties['Company'] = { rich_text: [{ text: { content: contact.company } }] };
    }
    if (contact.interactionCount !== undefined) {
      properties['Interaction Count'] = { number: contact.interactionCount };
    }
    if (contact.notes) {
      properties['Notes'] = { rich_text: [{ text: { content: contact.notes } }] };
    }

    return properties;
  }

  private buildDraftProperties(draft: Partial<Draft>): any {
    const properties: any = {};
    
    if (draft.title) {
      properties['Title'] = { title: [{ text: { content: draft.title } }] };
    }
    if (draft.contactId) {
      properties['Contact'] = { relation: [{ id: draft.contactId }] };
    }
    if (draft.sourceMessageId) {
      properties['Source Message ID'] = { rich_text: [{ text: { content: draft.sourceMessageId } }] };
    }
    if (draft.proposedReply) {
      properties['Proposed Reply'] = { rich_text: [{ text: { content: draft.proposedReply } }] };
    }
    if (draft.outlookDraftId) {
      properties['Outlook Draft ID'] = { rich_text: [{ text: { content: draft.outlookDraftId } }] };
    }
    if (draft.outlookWebLink) {
      properties['Outlook Web Link'] = { url: draft.outlookWebLink };
    }
    if (draft.status) {
      properties['Status'] = { select: { name: draft.status } };
    }
    if (draft.priority) {
      properties['Priority'] = { select: { name: draft.priority } };
    }
    if (draft.emailType) {
      properties['Email Type'] = { select: { name: draft.emailType } };
    }
    if (draft.wordCount !== undefined) {
      properties['Word Count'] = { number: draft.wordCount };
    }
    if (draft.voiceScore !== undefined) {
      properties['Voice Score'] = { number: draft.voiceScore };
    }

    return properties;
  }

  private buildInteractionProperties(interaction: Partial<Interaction>): any {
    const properties: any = {};
    
    if (interaction.title) {
      properties['Title'] = { title: [{ text: { content: interaction.title } }] };
    }
    if (interaction.contactId) {
      properties['Contact'] = { relation: [{ id: interaction.contactId }] };
    }
    if (interaction.sourceMessageId) {
      properties['Source Message ID'] = { rich_text: [{ text: { content: interaction.sourceMessageId } }] };
    }
    if (interaction.interactionType) {
      properties['Interaction Type'] = { select: { name: interaction.interactionType } };
    }
    if (interaction.subject) {
      properties['Subject'] = { rich_text: [{ text: { content: interaction.subject } }] };
    }
    if (interaction.summary) {
      properties['Summary'] = { rich_text: [{ text: { content: interaction.summary } }] };
    }
    if (interaction.sentiment) {
      properties['Sentiment'] = { select: { name: interaction.sentiment } };
    }
    if (interaction.actionRequired !== undefined) {
      properties['Action Required'] = { checkbox: interaction.actionRequired };
    }
    if (interaction.followUpDate) {
      properties['Follow-up Date'] = { date: { start: interaction.followUpDate } };
    }
    if (interaction.meetingScheduled !== undefined) {
      properties['Meeting Scheduled'] = { checkbox: interaction.meetingScheduled };
    }
    if (interaction.outcome) {
      properties['Outcome'] = { select: { name: interaction.outcome } };
    }
    if (interaction.relatedDraftId) {
      properties['Related Draft'] = { relation: [{ id: interaction.relatedDraftId }] };
    }

    return properties;
  }

  private buildKnowledgeBaseProperties(kb: Partial<KnowledgeBase>): any {
    const properties: any = {};
    
    if (kb.title) {
      properties['Title'] = { title: [{ text: { content: kb.title } }] };
    }
    if (kb.content) {
      properties['Content'] = { rich_text: [{ text: { content: kb.content } }] };
    }
    if (kb.category) {
      properties['Category'] = { select: { name: kb.category } };
    }
    if (kb.tags) {
      properties['Tags'] = { multi_select: kb.tags.map(tag => ({ name: tag })) };
    }
    if (kb.source) {
      properties['Source'] = { select: { name: kb.source } };
    }
    if (kb.confidenceScore !== undefined) {
      properties['Confidence Score'] = { number: kb.confidenceScore };
    }
    if (kb.usageCount !== undefined) {
      properties['Usage Count'] = { number: kb.usageCount };
    }
    if (kb.isActive !== undefined) {
      properties['Is Active'] = { checkbox: kb.isActive };
    }

    return properties;
  }

  private buildVoicePackProperties(voicePack: Partial<VoicePack>): any {
    const properties: any = {};
    
    if (voicePack.title) {
      properties['Title'] = { title: [{ text: { content: voicePack.title } }] };
    }
    if (voicePack.content) {
      properties['Content'] = { rich_text: [{ text: { content: voicePack.content } }] };
    }
    if (voicePack.source) {
      properties['Source'] = { select: { name: voicePack.source } };
    }
    if (voicePack.voiceElement) {
      properties['Voice Element'] = { select: { name: voicePack.voiceElement } };
    }
    if (voicePack.confidence !== undefined) {
      properties['Confidence'] = { number: voicePack.confidence };
    }
    if (voicePack.usageCount !== undefined) {
      properties['Usage Count'] = { number: voicePack.usageCount };
    }
    if (voicePack.isActive !== undefined) {
      properties['Is Active'] = { checkbox: voicePack.isActive };
    }
    if (voicePack.tags) {
      properties['Tags'] = { multi_select: voicePack.tags.map(tag => ({ name: tag })) };
    }
    if (voicePack.wordCount !== undefined) {
      properties['Word Count'] = { number: voicePack.wordCount };
    }

    return properties;
  }

  // Mapping methods
  private mapContactFromPage(page: any): Contact {
    return {
      id: page.id,
      email: page.properties.Email?.rich_text?.[0]?.text?.content || '',
      name: page.properties.Name?.title?.[0]?.text?.content || '',
      company: page.properties.Company?.rich_text?.[0]?.text?.content,
      lastInteraction: page.properties['Last Interaction']?.date?.start,
      interactionCount: page.properties['Interaction Count']?.number || 0,
      notes: page.properties.Notes?.rich_text?.[0]?.text?.content,
    };
  }

  private mapDraftFromPage(page: any): Draft {
    return {
      id: page.id,
      title: page.properties.Title?.title?.[0]?.text?.content || '',
      contactId: page.properties.Contact?.relation?.[0]?.id || '',
      sourceMessageId: page.properties['Source Message ID']?.rich_text?.[0]?.text?.content || '',
      proposedReply: page.properties['Proposed Reply']?.rich_text?.[0]?.text?.content || '',
      outlookDraftId: page.properties['Outlook Draft ID']?.rich_text?.[0]?.text?.content,
      outlookWebLink: page.properties['Outlook Web Link']?.url,
      status: page.properties.Status?.select?.name || 'Proposed',
      priority: page.properties.Priority?.select?.name || 'Medium',
      emailType: page.properties['Email Type']?.select?.name || 'Other',
      wordCount: page.properties['Word Count']?.number || 0,
      voiceScore: page.properties['Voice Score']?.number || 0,
    };
  }

  private mapInteractionFromPage(page: any): Interaction {
    return {
      id: page.id,
      title: page.properties.Title?.title?.[0]?.text?.content || '',
      contactId: page.properties.Contact?.relation?.[0]?.id || '',
      sourceMessageId: page.properties['Source Message ID']?.rich_text?.[0]?.text?.content || '',
      interactionType: page.properties['Interaction Type']?.select?.name || 'Inbound',
      subject: page.properties.Subject?.rich_text?.[0]?.text?.content || '',
      summary: page.properties.Summary?.rich_text?.[0]?.text?.content || '',
      sentiment: page.properties.Sentiment?.select?.name || 'Neutral',
      actionRequired: page.properties['Action Required']?.checkbox || false,
      followUpDate: page.properties['Follow-up Date']?.date?.start,
      meetingScheduled: page.properties['Meeting Scheduled']?.checkbox || false,
      outcome: page.properties.Outcome?.select?.name || 'In Progress',
      relatedDraftId: page.properties['Related Draft']?.relation?.[0]?.id,
    };
  }

  private mapKnowledgeBaseFromPage(page: any): KnowledgeBase {
    return {
      id: page.id,
      title: page.properties.Title?.title?.[0]?.text?.content || '',
      content: page.properties.Content?.rich_text?.[0]?.text?.content || '',
      category: page.properties.Category?.select?.name || 'Other',
      tags: page.properties.Tags?.multi_select?.map((tag: any) => tag.name) || [],
      source: page.properties.Source?.select?.name || 'Manual Entry',
      confidenceScore: page.properties['Confidence Score']?.number || 0,
      usageCount: page.properties['Usage Count']?.number || 0,
      isActive: page.properties['Is Active']?.checkbox || true,
    };
  }

  private mapVoicePackFromPage(page: any): VoicePack {
    return {
      id: page.id,
      title: page.properties.Title?.title?.[0]?.text?.content || '',
      content: page.properties.Content?.rich_text?.[0]?.text?.content || '',
      source: page.properties.Source?.select?.name || 'Manual Entry',
      voiceElement: page.properties['Voice Element']?.select?.name || 'Greeting',
      confidence: page.properties.Confidence?.number || 0,
      usageCount: page.properties['Usage Count']?.number || 0,
      isActive: page.properties['Is Active']?.checkbox || true,
      tags: page.properties.Tags?.multi_select?.map((tag: any) => tag.name) || [],
      wordCount: page.properties['Word Count']?.number || 0,
    };
  }
}

class NotionMCPServer {
  private server: Server;
  private notionClient: NotionClient;

  constructor() {
    this.server = new Server({
      name: 'notion-mcp',
      version: '1.0.0',
    });

    // Initialize Notion client with environment variables
    const apiKey = process.env.NOTION_API_KEY;
    const contactsDbId = process.env.NOTION_CONTACTS_DB_ID;
    const draftsDbId = process.env.NOTION_DRAFTS_DB_ID;
    const kbDbId = process.env.NOTION_KB_DB_ID;
    const interactionsDbId = process.env.NOTION_INTERACTIONS_DB_ID;
    const voicePackDbId = process.env.NOTION_VOICE_PACK_DB_ID;

    if (!apiKey || !contactsDbId || !draftsDbId || !kbDbId || !interactionsDbId || !voicePackDbId) {
      throw new Error('Missing required environment variables: NOTION_API_KEY, NOTION_*_DB_ID');
    }

    this.notionClient = new NotionClient(
      apiKey,
      contactsDbId,
      draftsDbId,
      kbDbId,
      interactionsDbId,
      voicePackDbId
    );

    this.setupToolHandlers();
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'find_contact',
            description: 'Find a contact by email address',
            inputSchema: {
              type: 'object',
              properties: {
                email: {
                  type: 'string',
                  description: 'Email address to search for',
                },
              },
              required: ['email'],
            },
          },
          {
            name: 'upsert_contact',
            description: 'Create or update a contact',
            inputSchema: {
              type: 'object',
              properties: {
                email: {
                  type: 'string',
                  description: 'Contact email address',
                },
                name: {
                  type: 'string',
                  description: 'Contact name',
                },
                company: {
                  type: 'string',
                  description: 'Company name',
                },
                notes: {
                  type: 'string',
                  description: 'Contact notes',
                },
                interactionCount: {
                  type: 'number',
                  description: 'Number of interactions',
                },
              },
              required: ['email'],
            },
          },
          {
            name: 'create_draft',
            description: 'Create a new email draft',
            inputSchema: {
              type: 'object',
              properties: {
                title: {
                  type: 'string',
                  description: 'Draft title',
                },
                contactId: {
                  type: 'string',
                  description: 'Contact ID',
                },
                sourceMessageId: {
                  type: 'string',
                  description: 'Source message ID',
                },
                proposedReply: {
                  type: 'string',
                  description: 'Proposed reply content',
                },
                outlookDraftId: {
                  type: 'string',
                  description: 'Outlook draft ID',
                },
                outlookWebLink: {
                  type: 'string',
                  description: 'Outlook web link',
                },
                priority: {
                  type: 'string',
                  enum: ['Low', 'Medium', 'High', 'Urgent'],
                  description: 'Priority level',
                },
                emailType: {
                  type: 'string',
                  enum: ['Inquiry', 'Follow-up', 'Support', 'Sales', 'Other'],
                  description: 'Email type',
                },
                wordCount: {
                  type: 'number',
                  description: 'Word count',
                },
                voiceScore: {
                  type: 'number',
                  description: 'Voice alignment score (0-1)',
                },
              },
              required: ['title', 'contactId', 'sourceMessageId', 'proposedReply'],
            },
          },
          {
            name: 'update_draft',
            description: 'Update an existing draft',
            inputSchema: {
              type: 'object',
              properties: {
                draftId: {
                  type: 'string',
                  description: 'Draft ID to update',
                },
                status: {
                  type: 'string',
                  enum: ['Proposed', 'Reviewing', 'Sent', 'Discarded'],
                  description: 'New status',
                },
                outlookWebLink: {
                  type: 'string',
                  description: 'Outlook web link',
                },
              },
              required: ['draftId'],
            },
          },
          {
            name: 'get_yesterday_drafts',
            description: 'Get all drafts created yesterday',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'log_interaction',
            description: 'Log an email interaction',
            inputSchema: {
              type: 'object',
              properties: {
                title: {
                  type: 'string',
                  description: 'Interaction title',
                },
                contactId: {
                  type: 'string',
                  description: 'Contact ID',
                },
                sourceMessageId: {
                  type: 'string',
                  description: 'Source message ID',
                },
                interactionType: {
                  type: 'string',
                  enum: ['Inbound', 'Outbound', 'Reply', 'Follow-up', 'Meeting', 'Call'],
                  description: 'Interaction type',
                },
                subject: {
                  type: 'string',
                  description: 'Email subject',
                },
                summary: {
                  type: 'string',
                  description: '2-sentence summary',
                },
                sentiment: {
                  type: 'string',
                  enum: ['Positive', 'Neutral', 'Negative', 'Urgent'],
                  description: 'Sentiment',
                },
                actionRequired: {
                  type: 'boolean',
                  description: 'Whether follow-up is needed',
                },
                outcome: {
                  type: 'string',
                  enum: ['Resolved', 'In Progress', 'Needs Follow-up', 'Escalated'],
                  description: 'Outcome',
                },
                relatedDraftId: {
                  type: 'string',
                  description: 'Related draft ID',
                },
              },
              required: ['title', 'contactId', 'sourceMessageId', 'interactionType', 'subject', 'summary'],
            },
          },
          {
            name: 'upsert_knowledge_base',
            description: 'Create or update knowledge base entry',
            inputSchema: {
              type: 'object',
              properties: {
                title: {
                  type: 'string',
                  description: 'Knowledge title',
                },
                content: {
                  type: 'string',
                  description: 'Knowledge content',
                },
                category: {
                  type: 'string',
                  enum: ['Company Info', 'Processes', 'Pricing', 'Support', 'Sales', 'Other'],
                  description: 'Category',
                },
                tags: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Tags',
                },
                source: {
                  type: 'string',
                  enum: ['Manual Entry', 'Email Extract', 'LinkedIn', 'Website', 'Other'],
                  description: 'Source',
                },
                confidenceScore: {
                  type: 'number',
                  description: 'Confidence score (0-1)',
                },
              },
              required: ['title', 'content'],
            },
          },
          {
            name: 'query_knowledge_base',
            description: 'Query knowledge base',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum results',
                  default: 10,
                },
              },
              required: ['query'],
            },
          },
          {
            name: 'upsert_voice_pack',
            description: 'Create or update voice pack entry',
            inputSchema: {
              type: 'object',
              properties: {
                title: {
                  type: 'string',
                  description: 'Voice pack title',
                },
                content: {
                  type: 'string',
                  description: 'Voice example content',
                },
                source: {
                  type: 'string',
                  enum: ['LinkedIn Post', 'Email Edit', 'Manual Entry', 'AI Generated'],
                  description: 'Source',
                },
                voiceElement: {
                  type: 'string',
                  enum: ['Greeting', 'Closing', 'Transition', 'Question Style', 'CTA Style'],
                  description: 'Voice element type',
                },
                confidence: {
                  type: 'number',
                  description: 'Confidence score (0-1)',
                },
                tags: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Context tags',
                },
                wordCount: {
                  type: 'number',
                  description: 'Word count',
                },
              },
              required: ['title', 'content', 'voiceElement'],
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'find_contact':
            const contact = await this.notionClient.findContact((args as any)?.email);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(contact, null, 2),
                },
              ],
            };

          case 'upsert_contact':
            const upsertedContact = await this.notionClient.upsertContact(args as any);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(upsertedContact, null, 2),
                },
              ],
            };

          case 'create_draft':
            const draft = await this.notionClient.createDraft(args as any);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(draft, null, 2),
                },
              ],
            };

          case 'update_draft':
            const updatedDraft = await this.notionClient.updateDraft((args as any)?.draftId, args as any);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(updatedDraft, null, 2),
                },
              ],
            };

          case 'get_yesterday_drafts':
            const drafts = await this.notionClient.getYesterdayDrafts();
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(drafts, null, 2),
                },
              ],
            };

          case 'log_interaction':
            const interaction = await this.notionClient.logInteraction(args as any);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(interaction, null, 2),
                },
              ],
            };

          case 'upsert_knowledge_base':
            const kb = await this.notionClient.upsertKnowledgeBase(args as any);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(kb, null, 2),
                },
              ],
            };

          case 'query_knowledge_base':
            const kbResults = await this.notionClient.queryKnowledgeBase(
              (args as any)?.query, 
              (args as any)?.limit
            );
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(kbResults, null, 2),
                },
              ],
            };

          case 'upsert_voice_pack':
            const voicePack = await this.notionClient.upsertVoicePack(args as any);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(voicePack, null, 2),
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
    console.error('Notion MCP server running on stdio');
  }
}

// Start the server
const server = new NotionMCPServer();
server.run().catch(console.error);
