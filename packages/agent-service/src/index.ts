import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import OpenAI from 'openai';
import { PineconeMemoryClient } from '@inbox-scout/memory-pinecone';

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
  private memoryClient: PineconeMemoryClient;
  private app: express.Application;
  private isProcessing: boolean = false;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    this.memoryClient = new PineconeMemoryClient(
      process.env.PINECONE_API_KEY!,
      process.env.PINECONE_ENVIRONMENT!,
      process.env.PINECONE_INDEX_NAME!,
      process.env.OPENAI_API_KEY!
    );

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
        processing: this.isProcessing 
      });
    });

    // Process single message endpoint
    this.app.post('/process-message', async (req, res) => {
      try {
        const { messageId } = req.body;
        const result = await this.processMessage(messageId);
        res.json(result);
      } catch (error) {
        console.error('Error processing message:', error);
        res.status(500).json({ error: 'Failed to process message' });
      }
    });

    // Get voice examples endpoint
    this.app.get('/voice-examples', async (req, res) => {
      try {
        const { context, voiceElement } = req.query;
        const examples = await this.memoryClient.getVoiceExamples(
          context as string,
          voiceElement as string
        );
        res.json(examples);
      } catch (error) {
        console.error('Error getting voice examples:', error);
        res.status(500).json({ error: 'Failed to get voice examples' });
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
      // This would integrate with the MCP Outlook client
      // For now, we'll simulate the process
      console.log('Processing unread emails...');
      
      // TODO: Implement actual email fetching via MCP
      // const unreadMessages = await outlookClient.getUnreadMessages();
      // for (const message of unreadMessages) {
      //   await this.processMessage(message.id);
      // }
      
    } catch (error) {
      console.error('Error processing unread emails:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  async processMessage(messageId: string): Promise<DraftResult> {
    try {
      console.log(`Processing message: ${messageId}`);

      // TODO: Integrate with MCP clients
      // 1. Get message from Outlook
      // const message = await outlookClient.getMessage(messageId);
      
      // 2. Find or create contact in Notion
      // const contact = await notionClient.findContact(message.from.emailAddress.address);
      
      // 3. Retrieve context from Pinecone
      // const context = await this.memoryClient.retrieveContext(
      //   message.body.content,
      //   message.from.emailAddress.address
      // );
      
      // 4. Generate draft reply
      // const draftReply = await this.generateDraftReply(message, context);
      
      // 5. Create Outlook draft
      // const draftId = await outlookClient.createReplyDraft(messageId);
      // await outlookClient.updateDraft(draftId, undefined, draftReply.html);
      // const webLink = await outlookClient.getMessageLink(draftId);
      
      // 6. Save to Notion
      // await notionClient.createDraft({
      //   title: `Re: ${message.subject}`,
      //   contactId: contact.id,
      //   sourceMessageId: messageId,
      //   proposedReply: draftReply.text,
      //   outlookDraftId: draftId,
      //   outlookWebLink: webLink,
      //   priority: this.determinePriority(message),
      //   emailType: this.classifyEmailType(message),
      //   wordCount: draftReply.text.split(' ').length,
      //   voiceScore: draftReply.voiceScore,
      // });
      
      // 7. Log interaction
      // await notionClient.logInteraction({
      //   title: `Email from ${contact.name}`,
      //   contactId: contact.id,
      //   sourceMessageId: messageId,
      //   interactionType: 'Inbound',
      //   subject: message.subject,
      //   summary: this.generateSummary(message),
      //   sentiment: this.analyzeSentiment(message),
      //   actionRequired: this.requiresAction(message),
      //   outcome: 'In Progress',
      // });
      
      // 8. Index email content
      // await this.memoryClient.indexEmail(messageId, message.body.content, {
      //   contactEmail: message.from.emailAddress.address,
      //   subject: message.subject,
      //   receivedDateTime: message.receivedDateTime,
      // });

      // For now, return a mock result
      return {
        draftId: `draft_${messageId}`,
        webLink: `https://outlook.office.com/mail/deeplink/read/${messageId}`,
        proposedReply: 'Thank you for your email. I will get back to you soon.',
        voiceScore: 0.85,
      };

    } catch (error) {
      console.error(`Error processing message ${messageId}:`, error);
      throw error;
    }
  }

  private async generateDraftReply(message: EmailMessage, context: any): Promise<{
    text: string;
    html: string;
    voiceScore: number;
  }> {
    try {
      // Get voice examples for context
      const voiceExamples = await this.memoryClient.getVoiceExamples(
        message.body,
        'Greeting'
      );

      // Build context for AI
      const contextText = this.buildContextText(context, voiceExamples);
      
      const systemPrompt = `You are Amy's AI assistant writing email replies in her voice.

VOICE TARGET (derived from LinkedIn + Sent edits):
• Tone: warm, direct, confident; plain English; no emojis
• Cadence: 2–4 short paragraphs; bullets OK; avoid walls of text
• Signature moves: start with 1-sentence why, address one concern, give 1 clear next step
• Phrases to favor: "Happy to…", "Two quick options…", "If helpful, I can…"
• Phrases to avoid: "Per my last…", "Kindly…"

Limits:
• ≤180 words unless explicitly asked for detail
• No facts without sources from context
• Ask 1 clarifying question if missing info

${contextText}`;

      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message.body },
        ],
        max_tokens: 300,
        temperature: 0.7,
      });

      const replyText = completion.choices[0]?.message?.content || '';
      const htmlReply = this.convertToHtml(replyText);
      
      // Calculate voice score (simplified)
      const voiceScore = this.calculateVoiceScore(replyText, voiceExamples);

      return {
        text: replyText,
        html: htmlReply,
        voiceScore,
      };

    } catch (error) {
      console.error('Error generating draft reply:', error);
      throw error;
    }
  }

  private buildContextText(context: any, voiceExamples: any[]): string {
    let contextText = '';

    if (context.notes.length > 0) {
      contextText += '\nCONTACT NOTES:\n';
      context.notes.forEach((note: any) => {
        contextText += `- ${note.metadata.content}\n`;
      });
    }

    if (context.kb.length > 0) {
      contextText += '\nRELEVANT KNOWLEDGE:\n';
      context.kb.forEach((kb: any) => {
        contextText += `- ${kb.metadata.content}\n`;
      });
    }

    if (context.emails.length > 0) {
      contextText += '\nSIMILAR EMAILS:\n';
      context.emails.forEach((email: any) => {
        contextText += `- ${email.metadata.content}\n`;
      });
    }

    if (voiceExamples.length > 0) {
      contextText += '\nVOICE EXAMPLES:\n';
      voiceExamples.forEach((example: any) => {
        contextText += `- ${example.metadata.content}\n`;
      });
    }

    return contextText;
  }

  private convertToHtml(text: string): string {
    return text
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>')
      .replace(/^/, '<p>')
      .replace(/$/, '</p>');
  }

  private calculateVoiceScore(text: string, voiceExamples: any[]): number {
    // Simplified voice scoring - in production, this would be more sophisticated
    const amyPhrases = ['Happy to', 'Two quick options', 'If helpful'];
    const avoidedPhrases = ['Per my last', 'Kindly'];
    
    let score = 0.5; // Base score
    
    // Check for preferred phrases
    amyPhrases.forEach(phrase => {
      if (text.includes(phrase)) score += 0.1;
    });
    
    // Check for avoided phrases
    avoidedPhrases.forEach(phrase => {
      if (text.includes(phrase)) score -= 0.2;
    });
    
    // Check length (prefer shorter)
    const wordCount = text.split(' ').length;
    if (wordCount <= 180) score += 0.1;
    
    return Math.min(Math.max(score, 0), 1);
  }

  private determinePriority(message: EmailMessage): 'Low' | 'Medium' | 'High' | 'Urgent' {
    const urgentKeywords = ['urgent', 'asap', 'immediately', 'emergency'];
    const highKeywords = ['important', 'priority', 'deadline'];
    
    const content = `${message.subject} ${message.body}`.toLowerCase();
    
    if (urgentKeywords.some(keyword => content.includes(keyword))) {
      return 'Urgent';
    }
    
    if (highKeywords.some(keyword => content.includes(keyword))) {
      return 'High';
    }
    
    return 'Medium';
  }

  private classifyEmailType(message: EmailMessage): 'Inquiry' | 'Follow-up' | 'Support' | 'Sales' | 'Other' {
    const content = `${message.subject} ${message.body}`.toLowerCase();
    
    if (content.includes('follow up') || content.includes('follow-up')) {
      return 'Follow-up';
    }
    
    if (content.includes('support') || content.includes('help') || content.includes('issue')) {
      return 'Support';
    }
    
    if (content.includes('purchase') || content.includes('buy') || content.includes('price')) {
      return 'Sales';
    }
    
    if (content.includes('question') || content.includes('?')) {
      return 'Inquiry';
    }
    
    return 'Other';
  }

  private generateSummary(message: EmailMessage): string {
    // Simplified summary generation
    const words = message.body.split(' ').slice(0, 20).join(' ');
    return `Email about: ${message.subject}. ${words}...`;
  }

  private analyzeSentiment(message: EmailMessage): 'Positive' | 'Neutral' | 'Negative' | 'Urgent' {
    const content = `${message.subject} ${message.body}`.toLowerCase();
    
    if (content.includes('urgent') || content.includes('emergency')) {
      return 'Urgent';
    }
    
    const negativeWords = ['problem', 'issue', 'complaint', 'disappointed', 'angry'];
    const positiveWords = ['thank', 'great', 'excellent', 'happy', 'pleased'];
    
    if (negativeWords.some(word => content.includes(word))) {
      return 'Negative';
    }
    
    if (positiveWords.some(word => content.includes(word))) {
      return 'Positive';
    }
    
    return 'Neutral';
  }

  private requiresAction(message: EmailMessage): boolean {
    const content = `${message.subject} ${message.body}`.toLowerCase();
    const actionWords = ['please', 'can you', 'could you', 'need', 'require'];
    
    return actionWords.some(word => content.includes(word));
  }

  async start(port: number = 3000): Promise<void> {
    return new Promise((resolve) => {
      this.app.listen(port, () => {
        console.log(`Inbox Scout Agent running on port ${port}`);
        resolve();
      });
    });
  }
}

// Start the agent service
const agent = new InboxScoutAgent();
const port = parseInt(process.env.AGENT_SERVICE_PORT || '3000');

agent.start(port).catch(console.error);
