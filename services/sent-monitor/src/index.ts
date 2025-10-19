import cron from 'node-cron';
import express from 'express';
import { diff_match_patch } from 'diff-match-patch';
// import { PineconeMemoryClient } from '@inbox-scout/memory-pinecone';

interface SentEmail {
  id: string;
  subject: string;
  body: string;
  conversationId: string;
  sentDateTime: string;
  webLink: string;
  toRecipients: Array<{
    emailAddress: {
      address: string;
      name: string;
    };
  }>;
}

interface DraftEdit {
  draftId: string;
  originalText: string;
  editedText: string;
  changes: string[];
  voiceInsights: {
    addedPhrases: string[];
    removedPhrases: string[];
    styleChanges: string[];
  };
}

class SentMonitorService {
  private app: express.Application;
  // private memoryClient: PineconeMemoryClient;
  private dmp: InstanceType<typeof diff_match_patch>;
  private processedEmails: Set<string> = new Set();

  constructor() {
    this.app = express();
    this.dmp = new diff_match_patch();
    
    // this.memoryClient = new PineconeMemoryClient(
    //   process.env.PINECONE_API_KEY!,
    //   process.env.PINECONE_ENVIRONMENT!,
    //   process.env.PINECONE_INDEX_NAME!,
    //   process.env.OPENAI_API_KEY!
    // );

    this.setupExpress();
    this.setupCronJob();
  }

  private setupExpress() {
    this.app.use(express.json());

    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'healthy', 
        service: 'sent-monitor',
        timestamp: new Date().toISOString(),
        processedEmails: this.processedEmails.size
      });
    });

    // Manual processing trigger
    this.app.post('/process-sent', async (req, res) => {
      try {
        await this.processSentEmails();
        res.json({ 
          success: true, 
          message: `Processed ${this.processedEmails.size} emails` 
        });
      } catch (error) {
        console.error('Error processing sent emails:', error);
        res.status(500).json({ error: 'Failed to process sent emails' });
      }
    });

    // Get voice insights
    this.app.get('/voice-insights', async (req, res) => {
      try {
        const insights = await this.getVoiceInsights();
        res.json(insights);
      } catch (error) {
        console.error('Error getting voice insights:', error);
        res.status(500).json({ error: 'Failed to get voice insights' });
      }
    });
  }

  private setupCronJob() {
    // Check for new sent emails every 5 minutes
    const interval = process.env.SENT_MONITOR_INTERVAL || '300000';
    const cronSchedule = `*/${parseInt(interval) / 60000} * * * *`;
    
    cron.schedule(cronSchedule, async () => {
      console.log('Checking for new sent emails...');
      try {
        await this.processSentEmails();
      } catch (error) {
        console.error('Error in sent monitor job:', error);
      }
    });

    console.log(`Sent monitor scheduled every ${parseInt(interval) / 60000} minutes`);
  }

  private async processSentEmails(): Promise<void> {
    try {
      // TODO: Integrate with MCP Outlook client
      // 1. Get recent sent emails
      // const sentEmails = await outlookClient.getSentEmails(24); // Last 24 hours
      
      // 2. For each sent email, check if it matches a draft
      // for (const email of sentEmails) {
      //   if (!this.processedEmails.has(email.id)) {
      //     await this.processSentEmail(email);
      //     this.processedEmails.add(email.id);
      //   }
      // }

      console.log('Processing sent emails...');
      
    } catch (error) {
      console.error('Error processing sent emails:', error);
      throw error;
    }
  }

  private async processSentEmail(sentEmail: SentEmail): Promise<void> {
    try {
      console.log(`Processing sent email: ${sentEmail.id}`);

      // TODO: Integrate with MCP clients
      // 1. Find matching draft in Notion by conversationId or subject/time
      // const matchingDraft = await notionClient.findDraftByConversation(sentEmail.conversationId);
      
      // if (matchingDraft) {
      //   // 2. Compare original draft with sent email
      //   const editAnalysis = this.analyzeEdits(matchingDraft.proposedReply, sentEmail.body);
      
      //   // 3. Update draft status to "Sent"
      //   await notionClient.updateDraft(matchingDraft.id, {
      //     status: 'Sent',
      //     outlookWebLink: sentEmail.webLink,
      //   });
      
      //   // 4. Learn from the edits
      //   await this.learnFromEdits(editAnalysis, matchingDraft);
      
      //   // 5. Update voice pack with new insights
      //   await this.updateVoicePack(editAnalysis);
      // }

      console.log(`Processed sent email: ${sentEmail.id}`);
      
    } catch (error) {
      console.error(`Error processing sent email ${sentEmail.id}:`, error);
    }
  }

  private analyzeEdits(originalText: string, editedText: string): DraftEdit {
    // Use diff-match-patch to analyze changes
    const diffs = this.dmp.diff_main(originalText, editedText);
    this.dmp.diff_cleanupSemantic(diffs);

    const changes: string[] = [];
    const addedPhrases: string[] = [];
    const removedPhrases: string[] = [];
    const styleChanges: string[] = [];

    diffs.forEach(([operation, text]: [number, string]) => {
      if (operation === 1) { // Added
        changes.push(`Added: "${text}"`);
        addedPhrases.push(text);
      } else if (operation === -1) { // Removed
        changes.push(`Removed: "${text}"`);
        removedPhrases.push(text);
      }
    });

    // Analyze style changes
    this.analyzeStyleChanges(originalText, editedText, styleChanges);

    return {
      draftId: '', // Will be set by caller
      originalText,
      editedText,
      changes,
      voiceInsights: {
        addedPhrases,
        removedPhrases,
        styleChanges,
      },
    };
  }

  private analyzeStyleChanges(original: string, edited: string, styleChanges: string[]): void {
    // Check for common style changes
    const originalWords = original.split(' ').length;
    const editedWords = edited.split(' ').length;
    
    if (editedWords < originalWords * 0.8) {
      styleChanges.push('Amy prefers shorter responses');
    } else if (editedWords > originalWords * 1.2) {
      styleChanges.push('Amy prefers more detailed responses');
    }

    // Check for greeting changes
    const originalGreeting = this.extractGreeting(original);
    const editedGreeting = this.extractGreeting(edited);
    
    if (originalGreeting !== editedGreeting) {
      styleChanges.push(`Greeting preference: "${editedGreeting}" over "${originalGreeting}"`);
    }

    // Check for closing changes
    const originalClosing = this.extractClosing(original);
    const editedClosing = this.extractClosing(edited);
    
    if (originalClosing !== editedClosing) {
      styleChanges.push(`Closing preference: "${editedClosing}" over "${originalClosing}"`);
    }
  }

  private extractGreeting(text: string): string {
    const lines = text.split('\n');
    const firstLine = lines[0]?.trim() || '';
    
    if (firstLine.match(/^(Hi|Hello|Hey|Good morning|Good afternoon)/i)) {
      return firstLine;
    }
    
    return '';
  }

  private extractClosing(text: string): string {
    const lines = text.split('\n');
    const lastLines = lines.slice(-3).join(' ').trim();
    
    if (lastLines.match(/(Best regards|Thanks|Thank you|Cheers|Best|Sincerely)/i)) {
      return lastLines;
    }
    
    return '';
  }

  private async learnFromEdits(editAnalysis: DraftEdit, draft: any): Promise<void> {
    try {
      // Update voice pack with new insights
      if (editAnalysis.voiceInsights.addedPhrases.length > 0) {
        // await this.memoryClient.updateVoiceFromEdit(
        //   editAnalysis.originalText,
        //   editAnalysis.editedText,
        //   {
        //     source: 'email_edit',
        //     draftId: draft.id,
        //     addedPhrases: editAnalysis.voiceInsights.addedPhrases,
        //     removedPhrases: editAnalysis.voiceInsights.removedPhrases,
        //     styleChanges: editAnalysis.voiceInsights.styleChanges,
        //   }
        // );
      }

      // Log the learning event
      console.log('Voice learning insights:', editAnalysis.voiceInsights);
      
    } catch (error) {
      console.error('Error learning from edits:', error);
    }
  }

  private async updateVoicePack(editAnalysis: DraftEdit): Promise<void> {
    try {
      // TODO: Integrate with Notion to update voice pack
      // await notionClient.upsertVoicePack({
      //   title: `Voice Learning - ${new Date().toISOString().split('T')[0]}`,
      //   content: editAnalysis.editedText,
      //   source: 'Email Edit',
      //   voiceElement: 'General',
      //   confidence: 0.8,
      //   tags: ['learned', 'email_edit'],
      //   wordCount: editAnalysis.editedText.split(' ').length,
      // });

      console.log('Voice pack updated with new insights');
      
    } catch (error) {
      console.error('Error updating voice pack:', error);
    }
  }

  private async getVoiceInsights(): Promise<any> {
    try {
      // TODO: Skip Pinecone voice insights for now
      // const voiceExamples = await this.memoryClient.searchSimilar(
      //   'Amy voice examples',
      //   'voice',
      //   10
      // );

      return {
        totalProcessedEmails: this.processedEmails.size,
        voiceExamples: [], // voiceExamples,
        lastUpdated: new Date().toISOString(),
      };
      
    } catch (error) {
      console.error('Error getting voice insights:', error);
      throw error;
    }
  }

  async start(port: number = 3002): Promise<void> {
    return new Promise((resolve) => {
      this.app.listen(port, () => {
        console.log(`Sent monitor service running on port ${port}`);
        resolve();
      });
    });
  }
}

// Start the sent monitor service
const sentMonitor = new SentMonitorService();
const port = parseInt(process.env.SENT_MONITOR_PORT || '3002');

sentMonitor.start(port).catch(console.error);
