import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { MCPOutlookClient } from '@inbox-scout/mcp-outlook';
import { MCPNotionClient } from '@inbox-scout/mcp-notion';
import { MemoryClient } from '@inbox-scout/memory-pinecone';
import { LinkedInIngester } from '@inbox-scout/ingest-linkedin';

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
  private aiFilterCache: Map<string, boolean> = new Map();

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
      
      // Automatically ingest LinkedIn data if not already ingested
      this.initializeLinkedInData().catch(error => {
        console.error('⚠️  Failed to initialize LinkedIn data:', error);
        // Don't fail startup if LinkedIn ingestion fails
      });
    } else {
      console.log('⚠️  Pinecone not configured - running without conversation memory');
    }

    this.app = express();
    this.setupExpress();
    this.setupCronJobs();
  }

  private async initializeLinkedInData(): Promise<void> {
    if (!this.memoryClient) {
      return;
    }

    try {
      console.log('🔍 Checking if LinkedIn data has been ingested...');
      
      // Check if LinkedIn data already exists
      const hasData = await this.memoryClient.hasLinkedInData();
      
      if (hasData) {
        console.log('✅ LinkedIn data already ingested - skipping ingestion');
        return;
      }

      console.log('📦 LinkedIn data not found - starting automatic ingestion...');
      
      // Look for LinkedIn export ZIP file
      const possiblePaths = [
        path.join(process.cwd(), 'linkedin-export.zip'),
        path.join(process.cwd(), 'linkedin-export.zip.zip'),
        path.join(process.cwd(), 'Complete_LinkedInDataExport_10-27-2025.zip.zip'),
        path.join(process.cwd(), 'Complete_LinkedInDataExport_10-27-2025.zip'),
      ];

      let zipPath: string | null = null;
      for (const possiblePath of possiblePaths) {
        if (fs.existsSync(possiblePath)) {
          zipPath = possiblePath;
          console.log(`📁 Found LinkedIn export: ${zipPath}`);
          break;
        }
      }

      if (!zipPath) {
        console.log('⚠️  LinkedIn export ZIP file not found - skipping ingestion');
        console.log('   Expected location: linkedin-export.zip in project root');
        return;
      }

      // Initialize LinkedIn ingester with memory client
      const ingester = new LinkedInIngester(this.memoryClient);
      
      console.log(`🚀 Starting LinkedIn ingestion from ${zipPath}...`);
      const voiceProfile = await ingester.ingestLinkedInExport(zipPath);
      
      console.log('🎉 LinkedIn ingestion completed successfully!');
      console.log(`   Processed LinkedIn content and generated voice profile`);
      console.log(`   Voice patterns: ${Object.keys(voiceProfile.lexicon.commonOpeners).length} patterns identified`);
      
    } catch (error: any) {
      console.error('❌ Error during LinkedIn ingestion:', error);
      
      // If it's a quota error, log helpful message but don't crash the service
      if (error?.code === 'insufficient_quota' || error?.status === 429) {
        console.error('');
        console.error('⚠️  LinkedIn ingestion failed due to OpenAI quota/rate limit');
        console.error('   The service will continue running without LinkedIn voice data');
        console.error('   Please check your OpenAI billing and try again later');
        console.error('   The ingestion will retry automatically on next deployment');
        console.error('');
        return; // Don't throw - allow service to continue
      }
      
      // For other errors, also allow service to continue
      console.error('   Service will continue running without LinkedIn voice data');
      // Don't throw - allow service to continue running
    }
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
      if (!(await this.shouldReplyToMessage(message))) {
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
          
          // Get voice guidance with email context for better semantic matching
          voiceGuidance = await this.memoryClient.getVoiceGuidance(message.body);
          
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

  private async shouldReplyToMessage(message: EmailMessage): Promise<boolean> {
    // Rule-based filtering (first pass - fast, no API calls)
    if (!this.passesRuleBasedFilter(message)) {
      return false;
    }

    // AI-based filtering (second pass - only for emails passing rule-based check)
    return this.shouldAmyReplyToEmail(message);
  }

  private passesRuleBasedFilter(message: EmailMessage): boolean {
    const emailAddress = message.from.emailAddress.address.toLowerCase();
    const subject = message.subject.toLowerCase();
    const body = message.body.toLowerCase();

    // Check sender email address for no-reply patterns
    const noReplyPatterns = [
      'noreply', 'no-reply', 'automated', 'donotreply', 
      'mailer-daemon', 'postmaster', 'notification',
      'no_reply', 'do-not-reply', 'do_not_reply',
      'mailerdaemon', 'autoreply', 'auto-reply'
    ];

    const hasNoReplyPattern = noReplyPatterns.some(pattern => 
      emailAddress.includes(pattern)
    );

    if (hasNoReplyPattern) {
      console.log(`Skipping email from ${emailAddress} - no-reply pattern detected`);
      return false;
    }

    // Check for common auto-reply indicators in subject/body
    const autoReplyPatterns = [
      'auto-reply', 'out of office', 'vacation', 'away',
      'delivery status notification', 'mail delivery system',
      'read receipt', 'delivery receipt', 'undeliverable',
      'failure notice', 'bounce', 'failed delivery'
    ];

    const hasAutoReplyPattern = autoReplyPatterns.some(pattern => 
      subject.includes(pattern) || body.includes(pattern)
    );

    if (hasAutoReplyPattern) {
      console.log(`Skipping email - auto-reply pattern detected`);
      return false;
    }

    // Check for bulk mailing patterns
    const bulkMailingPatterns = [
      'newsletter', 'unsubscribe', 'mailing list', 'marketing',
      'promotional', 'special offer', 'limited time',
      'view in browser', 'update preferences', 'manage subscription'
    ];

    const hasBulkMailingPattern = bulkMailingPatterns.some(pattern => 
      subject.includes(pattern) || body.includes(pattern)
    );

    if (hasBulkMailingPattern) {
      console.log(`Skipping email - bulk mailing pattern detected`);
      return false;
    }

    return true;
  }

  private async shouldAmyReplyToEmail(message: EmailMessage): Promise<boolean> {
    // Create a cache key based on email characteristics
    const cacheKey = `${message.from.emailAddress.address}_${message.subject.substring(0, 50)}`;
    
    // Check cache first
    if (this.aiFilterCache.has(cacheKey)) {
      return this.aiFilterCache.get(cacheKey)!;
    }

    try {
      const prompt = `Would Amy likely respond to this email? Consider:
- Is it a real person asking something actionable?
- Is it spam/automated?
- Is it a personal or business request that requires a response?
- Does it seem like a genuine inquiry that deserves a reply?

Email Details:
Subject: ${message.subject}
From: ${message.from.emailAddress.name} (${message.from.emailAddress.address})
Body (first 500 chars): ${message.body.substring(0, 500)}

Respond with ONLY "YES" or "NO" - no explanation needed.`;

      const completion = await this.openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4',
        messages: [
          {
            role: 'system',
            content: 'You are an email filtering assistant. Respond with only YES or NO based on whether Amy would likely respond to this email.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 10,
        temperature: 0.3
      });

      const response = completion.choices[0]?.message?.content?.trim().toUpperCase() || 'NO';
      const shouldReply = response.includes('YES');

      // Cache the result (limit cache size to prevent memory issues)
      if (this.aiFilterCache.size > 1000) {
        // Remove oldest entries
        const firstKey = this.aiFilterCache.keys().next().value;
        if (firstKey !== undefined) {
          this.aiFilterCache.delete(firstKey);
        }
      }
      this.aiFilterCache.set(cacheKey, shouldReply);

      return shouldReply;
    } catch (error) {
      console.error('Error in AI-based email filtering:', error);
      // On error, default to true (allow through) to avoid blocking legitimate emails
      return true;
    }
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
2. Matches Amy's voice and tone EXACTLY - use the writing examples and style patterns provided above
3. References past conversations when relevant
4. Addresses the sender's needs directly
5. Is concise but complete (≤180 words unless detail needed)
6. Maintains business relationships
7. Sounds natural and authentic, like Amy wrote it herself

Reply:`;

      const completion = await this.openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4',
        messages: [
          {
            role: 'system',
            content: 'You are Amy, a professional business owner who writes warm, friendly, and professional emails. Match Amy\'s voice and writing style exactly as shown in the examples provided.'
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