import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';

interface VectorItem {
  id: string;
  text: string;
  meta: Record<string, any>;
}

interface QueryResult {
  id: string;
  score: number;
  metadata: Record<string, any>;
}

interface ContextResult {
  notes: QueryResult[];
  voice: QueryResult[];
  kb: QueryResult[];
  emails: QueryResult[];
}

class PineconeMemoryClient {
  private pinecone: Pinecone;
  private openai: OpenAI;
  private index: any;

  constructor(
    apiKey: string,
    environment: string,
    indexName: string,
    openaiApiKey: string
  ) {
    this.pinecone = new Pinecone({
      apiKey,
      environment,
    });
    
    this.openai = new OpenAI({
      apiKey: openaiApiKey,
    });

    this.index = this.pinecone.index(indexName);
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    try {
      const response = await this.openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
      });
      
      return response.data[0].embedding;
    } catch (error) {
      throw new Error(`Failed to generate embedding: ${error}`);
    }
  }

  // Email indexing
  async indexEmail(emailId: string, content: string, metadata: Record<string, any>): Promise<void> {
    try {
      const embedding = await this.generateEmbedding(content);
      
      await this.index.upsert([{
        id: `email_${emailId}`,
        values: embedding,
        metadata: {
          type: 'email',
          content: content.substring(0, 1000), // Store first 1000 chars
          ...metadata,
        },
      }], 'emails');
    } catch (error) {
      throw new Error(`Failed to index email: ${error}`);
    }
  }

  // Voice pack indexing
  async indexVoice(items: VectorItem[]): Promise<void> {
    try {
      const vectors = await Promise.all(
        items.map(async (item) => {
          const embedding = await this.generateEmbedding(item.text);
          return {
            id: `voice_${item.id}`,
            values: embedding,
            metadata: {
              type: 'voice',
              content: item.text.substring(0, 1000),
              ...item.meta,
            },
          };
        })
      );

      await this.index.upsert(vectors, 'voice');
    } catch (error) {
      throw new Error(`Failed to index voice items: ${error}`);
    }
  }

  // Knowledge base indexing
  async indexKnowledge(kbId: string, content: string, metadata: Record<string, any>): Promise<void> {
    try {
      const embedding = await this.generateEmbedding(content);
      
      await this.index.upsert([{
        id: `kb_${kbId}`,
        values: embedding,
        metadata: {
          type: 'knowledge',
          content: content.substring(0, 1000),
          ...metadata,
        },
      }], 'kb');
    } catch (error) {
      throw new Error(`Failed to index knowledge: ${error}`);
    }
  }

  // Contact notes indexing
  async indexNotes(contactId: string, content: string, metadata: Record<string, any>): Promise<void> {
    try {
      const embedding = await this.generateEmbedding(content);
      
      await this.index.upsert([{
        id: `notes_${contactId}`,
        values: embedding,
        metadata: {
          type: 'notes',
          content: content.substring(0, 1000),
          ...metadata,
        },
      }], 'notes');
    } catch (error) {
      throw new Error(`Failed to index notes: ${error}`);
    }
  }

  // Retrieve context for email drafting
  async retrieveContext(query: string, contactEmail?: string): Promise<ContextResult> {
    try {
      const embedding = await this.generateEmbedding(query);
      
      // Query each namespace separately
      const [notesResults, voiceResults, kbResults, emailResults] = await Promise.all([
        this.index.query({
          vector: embedding,
          topK: 5,
          includeMetadata: true,
          filter: contactEmail ? { contactEmail } : undefined,
        }, 'notes'),
        
        this.index.query({
          vector: embedding,
          topK: 3,
          includeMetadata: true,
        }, 'voice'),
        
        this.index.query({
          vector: embedding,
          topK: 5,
          includeMetadata: true,
        }, 'kb'),
        
        this.index.query({
          vector: embedding,
          topK: 5,
          includeMetadata: true,
          filter: contactEmail ? { contactEmail } : undefined,
        }, 'emails'),
      ]);

      return {
        notes: notesResults.matches?.map((match: any) => ({
          id: match.id,
          score: match.score,
          metadata: match.metadata,
        })) || [],
        
        voice: voiceResults.matches?.map((match: any) => ({
          id: match.id,
          score: match.score,
          metadata: match.metadata,
        })) || [],
        
        kb: kbResults.matches?.map((match: any) => ({
          id: match.id,
          score: match.score,
          metadata: match.metadata,
        })) || [],
        
        emails: emailResults.matches?.map((match: any) => ({
          id: match.id,
          score: match.score,
          metadata: match.metadata,
        })) || [],
      };
    } catch (error) {
      throw new Error(`Failed to retrieve context: ${error}`);
    }
  }

  // Search for similar content
  async searchSimilar(
    query: string, 
    namespace: 'emails' | 'voice' | 'kb' | 'notes',
    topK: number = 10,
    filter?: Record<string, any>
  ): Promise<QueryResult[]> {
    try {
      const embedding = await this.generateEmbedding(query);
      
      const results = await this.index.query({
        vector: embedding,
        topK,
        includeMetadata: true,
        filter,
      }, namespace);

      return results.matches?.map((match: any) => ({
        id: match.id,
        score: match.score,
        metadata: match.metadata,
      })) || [];
    } catch (error) {
      throw new Error(`Failed to search similar: ${error}`);
    }
  }

  // Update voice pack after learning from edits
  async updateVoiceFromEdit(originalText: string, editedText: string, metadata: Record<string, any>): Promise<void> {
    try {
      // Generate embedding for the edited text
      const embedding = await this.generateEmbedding(editedText);
      
      // Create a new voice entry with the edited text
      await this.index.upsert([{
        id: `voice_edit_${Date.now()}`,
        values: embedding,
        metadata: {
          type: 'voice',
          content: editedText.substring(0, 1000),
          source: 'email_edit',
          originalText: originalText.substring(0, 500),
          ...metadata,
        },
      }], 'voice');
    } catch (error) {
      throw new Error(`Failed to update voice from edit: ${error}`);
    }
  }

  // Get voice examples for specific context
  async getVoiceExamples(context: string, voiceElement?: string): Promise<QueryResult[]> {
    try {
      const embedding = await this.generateEmbedding(context);
      
      const filter: any = {
        type: 'voice',
        isActive: true,
      };
      
      if (voiceElement) {
        filter.voiceElement = voiceElement;
      }

      const results = await this.index.query({
        vector: embedding,
        topK: 5,
        includeMetadata: true,
        filter,
      }, 'voice');

      return results.matches?.map((match: any) => ({
        id: match.id,
        score: match.score,
        metadata: match.metadata,
      })) || [];
    } catch (error) {
      throw new Error(`Failed to get voice examples: ${error}`);
    }
  }

  // Delete items by ID
  async deleteItems(ids: string[], namespace: 'emails' | 'voice' | 'kb' | 'notes'): Promise<void> {
    try {
      await this.index.deleteMany(ids, namespace);
    } catch (error) {
      throw new Error(`Failed to delete items: ${error}`);
    }
  }

  // Get index stats
  async getIndexStats(): Promise<Record<string, any>> {
    try {
      const stats = await this.index.describeIndexStats();
      return stats;
    } catch (error) {
      throw new Error(`Failed to get index stats: ${error}`);
    }
  }
}

// Export the client class
export { PineconeMemoryClient, VectorItem, QueryResult, ContextResult };
