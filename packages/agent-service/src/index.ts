import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import OpenAI from 'openai';
import { MCPOutlookClient } from '@inbox-scout/mcp-outlook';
import { MCPNotionClient } from '@inbox-scout/mcp-notion';
import { MemoryClient } from '@inbox-scout/memory-pinecone';

interface EmailMessage {
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

interface DraftResult {
  draftId: string;
  webLink: string;
  proposedReply: string;
  voiceScore: number;
}

class InboxScoutAgent {
  private openai: OpenAI;
  private outlookClient: MCPOutlookClient;
  private notionClient: MCPNotionClient;
  private memoryClient: MemoryClient | null = null;
  private app: express.Application;
  private isProcessing: boolean = false;

  constructor() {
    // Check for required environment variables
    const requiredEnvVars = [
      'OPENAI_API_KEY',
      'NOTION_API_KEY',
      'NOTION_CONTACTS_DB_ID',
      'NOTION_DRAFTS_DB_ID',
      'NOTION_KB_DB_ID',
      'NOTION_INTERACTIONS_DB_ID',
      'NOTION_VOICE_PACK_DB_ID',
      'AZURE_TENANT_ID',
      'AZURE_CLIENT_ID',
      'AZURE_CLIENT_SECRET'
    ];
    
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    if (missingVars.length > 0) {
      console.error('❌ Missing required environment variables:', missingVars.join(', '));
      console.error('Please set all required environment variables before starting the service.');
      process.exit(1);
    }

    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });


    this.outlookClient = new MCPOutlookClient(
      process.env.AZURE_TENANT_ID!,
      process.env.AZURE_CLIENT_ID!,
      process.env.AZURE_CLIENT_SECRET!
    );

    this.notionClient = new MCPNotionClient(
      process.env.NOTION_API_KEY!,
      {
        contacts: process.env.NOTION_CONTACTS_DB_ID!,
        drafts: process.env.NOTION_DRAFTS_DB_ID!,
        interactions: process.env.NOTION_INTERACTIONS_DB_ID!,
        knowledgeBase: process.env.NOTION_KB_DB_ID!,
        voicePack: process.env.NOTION_VOICE_PACK_DB_ID!
      }
    );

    // Initialize memory client if Pinecone credentials are provided
    if (process.env.PINECONE_API_KEY && process.env.PINECONE_ENVIRONMENT && process.env.PINECONE_INDEX_NAME) {
      console.log('🧠 Initializing memory client with Pinecone...');
      this.memoryClient = new MemoryClient(
        process.env.PINECONE_API_KEY,
        process.env.PINECONE_ENVIRONMENT,
        process.env.PINECONE_INDEX_NAME,
        process.env.OPENAI_API_KEY!
      );
      console.log('✅ Memory client initialized');
    } else {
      console.log('⚠️  Pinecone not configured - running without conversation memory');
    }

    this.app = express();
    this.setupExpress();
    this.setupCronJobs();
  }

  private setupExpress() {
    this.app.use(cors());
    this.app.use(express.json());

    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'InboxScout Agent',
        version: '1.0.0'
      });
    });

    // Manual trigger endpoint for testing
    this.app.post('/process-emails', async (req, res) => {
      try {
        if (this.isProcessing) {
          return res.status(409).json({ error: 'Already processing emails' });
        }

        await this.processUnreadEmails();
        res.json({ message: 'Email processing completed' });
      } catch (error) {
        console.error('Error in manual email processing:', error);
        res.status(500).json({ error: 'Failed to process emails' });
      }
    });
  }

  private setupCronJobs() {
    // Process unread emails every 5 minutes
    cron.schedule('*/5 * * * *', async () => {
      if (!this.isProcessing) {
        await this.processUnreadEmails();
      }
    });

    console.log('Cron jobs scheduled');
  }

  private async processUnreadEmails(): Promise<void> {
    this.isProcessing = true;
    console.log('Starting to process unread emails...');

    try {
      const unreadMessages = await this.outlookClient.getUnreadMessages();
      console.log(`Found ${unreadMessages.length} unread emails`);

      for (const message of unreadMessages) {
        try {
          console.log(`Processing email: ${message.subject} from ${message.from.emailAddress.address}`);
          
          const result = await this.processMessage(message.id);
          
          if (result) {
            console.log(`✅ Processed email from ${message.from.emailAddress.address}`);
            console.log(`   Draft ID: ${result.draftId}`);
            console.log(`   Voice Score: ${result.voiceScore}`);
          }
        } catch (error) {
          console.error(`Error processing email ${message.id}:`, error);
        }
      }
      
    } catch (error) {
      console.error('Error processing unread emails:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  async processMessage(messageId: string): Promise<DraftResult | null> {
    try {
      console.log(`Processing message: ${messageId}`);

      // 1. Get message from Outlook
      const message = await this.outlookClient.getMessage(messageId);
      
      // Check if this message needs a reply
      if (!this.shouldReplyToMessage(message)) {
        console.log(`Skipping message ${messageId} - no reply needed`);
        return null;
      }

      // 2. Find or create contact in Notion
      const contact = await this.notionClient.findOrCreateContact({
        email: message.from.emailAddress.address,
        name: message.from.emailAddress.name || message.from.emailAddress.address,
        lastInteraction: new Date().toISOString()
      });

      // 3. Get conversation context and voice guidance from memory
      let contextText = '';
      let voiceGuidance = '';
      
      if (this.memoryClient) {
        try {
          // Get past conversation context
          contextText = await this.memoryClient.buildContextForDraft(
            message.from.emailAddress.address,
            message.body
          );
          
          // Get voice guidance
          voiceGuidance = await this.memoryClient.getVoiceGuidance();
          
          console.log(`📚 Retrieved context for ${message.from.emailAddress.address}`);
        } catch (error) {
          console.error('Error retrieving memory context:', error);
        }
      }

      // 4. Generate draft reply with context and voice guidance
      const draftReply = await this.generateDraftReply(message, contextText, voiceGuidance);
      
      // 5. Create Outlook draft
      const draft = await this.outlookClient.createReplyDraft(messageId, draftReply.text);
      
      // 6. Save to Notion
      await this.notionClient.createDraft({
        messageId: messageId,
        subject: message.subject,
        from: message.from.emailAddress.address,
        draftText: draftReply.text,
        voiceScore: draftReply.voiceScore,
        status: 'pending_review',
        createdAt: new Date().toISOString()
      });

      // 7. Log interaction
      await this.notionClient.createInteraction({
        messageId: messageId,
        subject: message.subject,
        from: message.from.emailAddress.address,
        timestamp: new Date().toISOString(),
        status: 'processed',
        draftId: draft.id,
        voiceScore: draftReply.voiceScore
      });

      // 8. Store conversation in memory for future reference
      if (this.memoryClient) {
        try {
          await this.memoryClient.storeConversation({
            emailId: messageId,
            subject: message.subject,
            from: message.from.emailAddress.address,
            body: message.body,
            timestamp: message.receivedDateTime,
            summary: `Email from ${message.from.emailAddress.name || message.from.emailAddress.address}`
          });
          console.log('💾 Stored conversation in memory');
        } catch (error) {
          console.error('Error storing conversation:', error);
        }
      }

      return {
        draftId: draft.id,
        webLink: draft.webLink,
        proposedReply: draftReply.text,
        voiceScore: draftReply.voiceScore
      };
      
    } catch (error) {
      console.error(`Error processing message ${messageId}:`, error);
      throw error;
    }
  }

  private shouldReplyToMessage(message: EmailMessage): boolean {
    const subject = message.subject.toLowerCase();
    const body = message.body.toLowerCase();

    // Skip auto-replies, newsletters, etc.
    const skipPatterns = [
      'auto-reply', 'out of office', 'vacation', 'away',
      'newsletter', 'unsubscribe', 'noreply', 'no-reply',
      'delivery status notification', 'mail delivery system'
    ];

    return !skipPatterns.some(pattern => 
      subject.includes(pattern) || body.includes(pattern)
    );
  }

  private async generateDraftReply(message: EmailMessage, contextText: string, voiceGuidance: string): Promise<{ text: string; voiceScore: number }> {
    try {
      const prompt = `
You are Amy, a business owner who runs an online business. Write a professional, friendly email reply.

Original email:
Subject: ${message.subject}
From: ${message.from.emailAddress.name} (${message.from.emailAddress.address})
Body: ${message.body}

${contextText || ''}

${voiceGuidance || ''}

Write a reply that:
1. Is professional but warm and friendly
2. Matches Amy's voice and tone (use the voice profile above)
3. References past conversations when relevant
4. Addresses the sender's needs directly
5. Is concise but complete (≤180 words unless detail needed)
6. Maintains business relationships

Reply:`;

      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: 'You are Amy, a professional business owner who writes warm, friendly, and professional emails.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 500,
        temperature: 0.7
      });

      const replyText = completion.choices[0]?.message?.content || 'Thank you for your email. I will get back to you soon.';
      
      // Simple voice scoring based on length and politeness
      const voiceScore = this.calculateVoiceScore(replyText);

      return {
        text: replyText,
        voiceScore
      };
    } catch (error) {
      console.error('Error generating draft reply:', error);
      return {
        text: 'Thank you for your email. I will get back to you soon.',
        voiceScore: 0.5
      };
    }
  }

  private calculateVoiceScore(text: string): number {
    // Simple scoring based on text characteristics
    const words = text.split(' ');
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    
    // Base score
    let score = 0.5;
    
    // Length scoring (prefer medium length)
    if (words.length >= 20 && words.length <= 100) score += 0.2;
    if (words.length < 10) score -= 0.2;
    
    // Politeness indicators
    const politeWords = ['thank', 'please', 'appreciate', 'grateful', 'wonderful', 'excellent'];
    const politeCount = politeWords.filter(word => text.toLowerCase().includes(word)).length;
    score += politeCount * 0.05;
    
    // Professional tone indicators
    const professionalWords = ['regarding', 'furthermore', 'however', 'therefore', 'additionally'];
    const professionalCount = professionalWords.filter(word => text.toLowerCase().includes(word)).length;
    score += professionalCount * 0.03;
    
    return Math.min(Math.max(score, 0), 1);
  }

  async start(port: number = 3000): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';
        
        this.app.listen(port, host, () => {
          console.log(`🚀 InboxScout Agent running on ${host}:${port}`);
          console.log(`📧 Monitoring: ${process.env.CLIENT_EMAIL || 'amy@alignedtribe.com'}`);
          console.log(`⏰ Timezone: ${process.env.CLIENT_TIMEZONE || 'Australia/Sydney'}`);
          console.log(`🏥 Health check: http://${host}:${port}/health`);
          resolve();
        });
      } catch (error) {
        console.error('❌ Failed to start server:', error);
        reject(error);
      }
    });
  }
}

// Start the agent service
const agent = new InboxScoutAgent();
const port = parseInt(process.env.PORT || process.env.AGENT_SERVICE_PORT || '3000');

agent.start(port).catch((error) => {
  console.error('❌ Failed to start InboxScout Agent:', error);
  process.exit(1);
});