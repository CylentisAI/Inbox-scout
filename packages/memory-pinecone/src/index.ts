import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';

export interface ConversationContext {
  emailId: string;
  subject: string;
  from: string;
  body: string;
  timestamp: string;
  summary?: string;
}

export interface VoicePattern {
  pattern: string;
  frequency: number;
  context: string;
  source: 'linkedin' | 'email' | 'edit';
}

export interface SearchResult {
  id: string;
  score: number;
  metadata: Record<string, any>;
  text?: string;
}

export class MemoryClient {
  private pinecone: Pinecone;
  private openai: OpenAI;
  private indexName: string;

  constructor(
    apiKey: string,
    environment: string,
    indexName: string,
    openaiApiKey: string
  ) {
    this.pinecone = new Pinecone({
      apiKey: apiKey,
    });
    
    this.openai = new OpenAI({
      apiKey: openaiApiKey,
    });

    this.indexName = indexName;
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    const maxRetries = 3;
    let retryCount = 0;
    
    while (retryCount < maxRetries) {
      try {
        const response = await this.openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: text,
        });

        return response.data[0].embedding;
      } catch (error: any) {
        // Handle quota errors - don't retry immediately, wait longer
        if (error?.code === 'insufficient_quota' || error?.status === 429) {
          console.error(`⚠️  OpenAI quota exceeded or rate limited. Waiting before retry...`);
          
          if (retryCount < maxRetries - 1) {
            // Exponential backoff: wait longer each time (60s, 120s, 240s)
            const waitTime = Math.pow(2, retryCount) * 60 * 1000;
            console.log(`⏳ Waiting ${waitTime / 1000}s before retry ${retryCount + 1}/${maxRetries}...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            retryCount++;
            continue;
          } else {
            // Final retry failed - throw error
            console.error('❌ OpenAI quota/rate limit error after retries. Please check your OpenAI billing.');
            throw error;
          }
        }
        
        // For other errors, retry with shorter backoff
        if (retryCount < maxRetries - 1) {
          const waitTime = (retryCount + 1) * 1000; // 1s, 2s, 3s
          console.log(`⏳ Retrying embedding generation (${retryCount + 1}/${maxRetries}) after ${waitTime}ms...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          retryCount++;
          continue;
        }
        
        throw error;
      }
    }
    
    throw new Error('Failed to generate embedding after retries');
  }

  // Store a conversation in memory
  async storeConversation(context: ConversationContext): Promise<void> {
    try {
      const index = this.pinecone.index(this.indexName);
      
      // Create searchable text
      const searchText = `Subject: ${context.subject}\nFrom: ${context.from}\n${context.body}`;
      const embedding = await this.generateEmbedding(searchText);

      await index.namespace('conversations').upsert([
        {
          id: context.emailId,
          values: embedding,
          metadata: {
            subject: context.subject,
            from: context.from,
            timestamp: context.timestamp,
            summary: context.summary || '',
            body: context.body.substring(0, 1000), // Store first 1000 chars
          },
        },
      ]);

      console.log(`Stored conversation: ${context.emailId}`);
    } catch (error) {
      console.error('Error storing conversation:', error);
      throw error;
    }
  }

  // Retrieve past conversations with a contact
  async getConversationHistory(
    contactEmail: string,
    limit: number = 5
  ): Promise<SearchResult[]> {
    try {
      const index = this.pinecone.index(this.indexName);
      
      // Search for conversations with this contact
      const queryEmbedding = await this.generateEmbedding(contactEmail);

      const results = await index.namespace('conversations').query({
        vector: queryEmbedding,
        topK: limit,
        includeMetadata: true,
        filter: {
          from: { $eq: contactEmail },
        },
      });

      return results.matches?.map((match) => ({
        id: match.id,
        score: match.score || 0,
        metadata: match.metadata || {},
        text: match.metadata?.body as string,
      })) || [];
    } catch (error) {
      console.error('Error retrieving conversation history:', error);
      return [];
    }
  }

  // Search for relevant context based on current email content
  async searchRelevantContext(
    query: string,
    contactEmail: string,
    limit: number = 3
  ): Promise<SearchResult[]> {
    try {
      const index = this.pinecone.index(this.indexName);
      
      const queryEmbedding = await this.generateEmbedding(query);

      const results = await index.namespace('conversations').query({
        vector: queryEmbedding,
        topK: limit,
        includeMetadata: true,
        filter: {
          from: { $eq: contactEmail },
        },
      });

      return results.matches?.map((match) => ({
        id: match.id,
        score: match.score || 0,
        metadata: match.metadata || {},
        text: match.metadata?.body as string,
      })) || [];
    } catch (error) {
      console.error('Error searching relevant context:', error);
      return [];
    }
  }

  // Store voice patterns learned from LinkedIn or email edits
  async storeVoicePattern(pattern: VoicePattern): Promise<void> {
    try {
      const index = this.pinecone.index(this.indexName);
      
      const embedding = await this.generateEmbedding(pattern.pattern);
      const patternId = `voice-${pattern.source}-${Date.now()}`;

      await index.namespace('voice').upsert([
        {
          id: patternId,
          values: embedding,
          metadata: {
            pattern: pattern.pattern,
            frequency: pattern.frequency,
            context: pattern.context,
            source: pattern.source,
            timestamp: new Date().toISOString(),
          },
        },
      ]);

      console.log(`Stored voice pattern: ${patternId}`);
    } catch (error) {
      console.error('Error storing voice pattern:', error);
      throw error;
    }
  }

  // Check if LinkedIn data has been ingested
  async hasLinkedInData(): Promise<boolean> {
    try {
      const index = this.pinecone.index(this.indexName);
      
      // Try to query for LinkedIn voice patterns
      const queryEmbedding = await this.generateEmbedding('linkedin post writing style');
      
      const results = await index.namespace('voice').query({
        vector: queryEmbedding,
        topK: 1,
        includeMetadata: true,
        filter: {
          source: { $eq: 'linkedin' }
        },
      });

      return (results.matches?.length || 0) > 0;
    } catch (error) {
      console.error('Error checking LinkedIn data:', error);
      return false;
    }
  }

  // Get voice patterns for draft generation
  async getVoicePatterns(limit: number = 10): Promise<SearchResult[]> {
    try {
      const index = this.pinecone.index(this.indexName);
      
      // Get top voice patterns by frequency
      const queryEmbedding = await this.generateEmbedding('email communication style tone voice');

      const results = await index.namespace('voice').query({
        vector: queryEmbedding,
        topK: limit,
        includeMetadata: true,
      });

      return results.matches?.map((match) => ({
        id: match.id,
        score: match.score || 0,
        metadata: match.metadata || {},
        text: match.metadata?.pattern as string,
      })) || [];
    } catch (error) {
      console.error('Error retrieving voice patterns:', error);
      return [];
    }
  }

  // Learn from email edits (compare draft vs sent)
  async learnFromEdit(
    draftText: string,
    sentText: string,
    context: string
  ): Promise<void> {
    try {
      // Extract differences and patterns
      const patterns = this.extractEditPatterns(draftText, sentText);
      
      // Store each pattern
      for (const pattern of patterns) {
        await this.storeVoicePattern({
          pattern: pattern,
          frequency: 1,
          context: context,
          source: 'edit',
        });
      }

      console.log(`Learned ${patterns.length} patterns from edit`);
    } catch (error) {
      console.error('Error learning from edit:', error);
      throw error;
    }
  }

  // Extract patterns from draft vs sent comparison
  private extractEditPatterns(draft: string, sent: string): string[] {
    const patterns: string[] = [];
    
    // Simple pattern extraction - look for added phrases
    const draftWords = draft.toLowerCase().split(/\s+/);
    const sentWords = sent.toLowerCase().split(/\s+/);
    
    // Find added phrases (in sent but not in draft)
    const added = sentWords.filter(word => !draftWords.includes(word));
    if (added.length > 0) {
      patterns.push(`Added: ${added.slice(0, 10).join(' ')}`);
    }
    
    // Find removed phrases (in draft but not in sent)
    const removed = draftWords.filter(word => !sentWords.includes(word));
    if (removed.length > 0) {
      patterns.push(`Removed: ${removed.slice(0, 10).join(' ')}`);
    }

    return patterns;
  }

  // Ingest LinkedIn content for initial voice profile
  async ingestLinkedInContent(posts: { text: string; date: string }[]): Promise<void> {
    try {
      console.log(`Ingesting ${posts.length} LinkedIn posts...`);
      console.log(`⏳ Rate limiting: 100ms delay between posts to avoid quota issues`);
      
      let successCount = 0;
      let errorCount = 0;
      
      for (let i = 0; i < posts.length; i++) {
        const post = posts[i];
        
        try {
          // Extract voice patterns from LinkedIn posts
          await this.storeVoicePattern({
            pattern: post.text,
            frequency: 1,
            context: 'LinkedIn post',
            source: 'linkedin',
          });
          
          successCount++;
          
          // Rate limiting: small delay between posts to avoid hitting rate limits
          if (i < posts.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          
          // Progress indicator every 50 posts
          if ((i + 1) % 50 === 0) {
            console.log(`  Progress: ${i + 1}/${posts.length} posts indexed (${successCount} success, ${errorCount} errors)`);
          }
        } catch (error: any) {
          errorCount++;
          
          // If quota error, stop processing and log warning
          if (error?.code === 'insufficient_quota' || error?.status === 429) {
            console.error(`⚠️  Stopping ingestion due to OpenAI quota/rate limit error`);
            console.error(`   Processed ${successCount} posts successfully before error`);
            console.error(`   Remaining ${posts.length - i - 1} posts will be skipped`);
            console.error(`   Please check your OpenAI billing and try again later`);
            throw error;
          }
          
          // For other errors, log but continue
          console.error(`⚠️  Error indexing post ${i + 1}/${posts.length}:`, error.message);
          
          // Longer delay after error to avoid cascade failures
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      console.log(`✅ Ingestion complete: ${successCount} posts indexed successfully, ${errorCount} errors`);
      
      if (errorCount > 0) {
        console.log(`⚠️  Some posts failed to index. Check logs above for details.`);
      }
    } catch (error) {
      console.error('Error ingesting LinkedIn content:', error);
      throw error;
    }
  }

  // Build context summary for draft generation
  async buildContextForDraft(
    contactEmail: string,
    currentEmailBody: string
  ): Promise<string> {
    try {
      // Get conversation history
      const history = await this.getConversationHistory(contactEmail, 3);
      
      // Get relevant context based on current email
      const relevantContext = await this.searchRelevantContext(
        currentEmailBody,
        contactEmail,
        2
      );

      // Build context string
      let context = '';
      
      if (history.length > 0) {
        context += '\n\n## Past Conversations:\n';
        history.forEach((conv, i) => {
          context += `\n${i + 1}. ${conv.metadata.subject} (${conv.metadata.timestamp}):\n`;
          context += `${conv.text?.substring(0, 200)}...\n`;
        });
      }

      if (relevantContext.length > 0) {
        context += '\n\n## Relevant Context:\n';
        relevantContext.forEach((ctx, i) => {
          if (ctx.id !== history[0]?.id) { // Avoid duplicates
            context += `\n${ctx.text?.substring(0, 200)}...\n`;
          }
        });
      }

      return context;
    } catch (error) {
      console.error('Error building context for draft:', error);
      return '';
    }
  }

  // Get voice guidance for draft generation
  async getVoiceGuidance(emailContext?: string): Promise<string> {
    try {
      const index = this.pinecone.index(this.indexName);
      
      // Search for relevant LinkedIn content based on email context
      let relevantLinkedInContent: SearchResult[] = [];
      
      if (emailContext && emailContext.length > 0) {
        // Use semantic search to find relevant LinkedIn posts
        const emailEmbedding = await this.generateEmbedding(emailContext);
        
        const linkedInResults = await index.namespace('voice').query({
          vector: emailEmbedding,
          topK: 5,
          includeMetadata: true,
          filter: {
            source: { $eq: 'linkedin' }
          },
        });

        relevantLinkedInContent = linkedInResults.matches?.map((match) => ({
          id: match.id,
          score: match.score || 0,
          metadata: match.metadata || {},
          text: match.metadata?.pattern as string,
        })) || [];
      }
      
      // Also get general voice patterns
      const patterns = await this.getVoicePatterns(10);
      
      if (patterns.length === 0 && relevantLinkedInContent.length === 0) {
        return '';
      }

      let guidance = '\n\n## Amy\'s Voice Profile:\n';
      
      // Add actual writing samples from LinkedIn that match the email context
      if (relevantLinkedInContent.length > 0) {
        guidance += '\n### Relevant Writing Style Examples:\n';
        guidance += 'These examples match the tone and context of this email:\n\n';
        
        relevantLinkedInContent.slice(0, 3).forEach((sample, i) => {
          if (sample.text && sample.text.length > 50) {
            const truncated = sample.text.substring(0, 200);
            guidance += `${i + 1}. "${truncated}${sample.text.length > 200 ? '...' : ''}"\n\n`;
          }
        });
      }
      
      // Add general voice patterns
      if (patterns.length > 0) {
        guidance += '\n### Common Voice Patterns:\n';
        guidance += 'Use these patterns and style elements:\n';
        
        patterns.forEach((pattern, i) => {
          if (pattern.text && pattern.text.length > 0) {
            // Show full pattern if it's short, otherwise truncate
            const displayText = pattern.text.length > 150 
              ? pattern.text.substring(0, 150) + '...' 
              : pattern.text;
            guidance += `\n- ${displayText}`;
          }
        });
      }
      
      // Add style guidance based on LinkedIn content analysis
      guidance += '\n\n### Writing Style Guidelines:\n';
      guidance += '- Write in a warm, professional tone\n';
      guidance += '- Be concise but complete\n';
      guidance += '- Use natural, conversational language\n';
      guidance += '- Match the tone and style of the examples above\n';

      return guidance;
    } catch (error) {
      console.error('Error getting voice guidance:', error);
      return '';
    }
  }
}

export default MemoryClient;
