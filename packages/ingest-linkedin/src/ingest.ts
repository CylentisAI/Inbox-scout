import * as fs from 'fs';
import * as path from 'path';
import * as yauzl from 'yauzl';
import { createReadStream } from 'fs';
import csv from 'csv-parser';
// import { PineconeMemoryClient } from '@inbox-scout/memory-pinecone';

interface LinkedInContent {
  text: string;
  date: string;
  url: string;
  kind: 'article' | 'post' | 'comment' | 'share';
  source: string;
}

interface VoiceProfile {
  lexicon: {
    commonOpeners: string[];
    commonClosers: string[];
    signOffs: string[];
    hedges: string[];
    rhetoricalQuestions: string[];
  };
  cadence: {
    averageSentenceLength: number;
    averageParagraphCount: number;
    bulletUsage: number;
  };
  toneSliders: {
    warmth: number;
    directness: number;
    formality: number;
  };
  signatureMoves: string[];
}

class LinkedInIngester {
  // private memoryClient: PineconeMemoryClient;
  private extractedContent: LinkedInContent[] = [];

  constructor() {
    // this.memoryClient = new PineconeMemoryClient(
    //   process.env.PINECONE_API_KEY!,
    //   process.env.PINECONE_ENVIRONMENT!,
    //   process.env.PINECONE_INDEX_NAME!,
    //   process.env.OPENAI_API_KEY!
    // );
  }

  async ingestLinkedInExport(zipPath: string): Promise<VoiceProfile> {
    try {
      console.log(`Starting LinkedIn ingestion from: ${zipPath}`);
      
      // 1. Extract ZIP file
      const extractedPath = await this.extractZip(zipPath);
      
      // 2. Parse LinkedIn data
      await this.parseLinkedInData(extractedPath);
      
      // 3. Build voice profile
      const voiceProfile = this.buildVoiceProfile();
      
      // 4. Skip Pinecone indexing
      await this.indexVoiceContent();
      
      // 5. Save voice profile to Notion
      await this.saveVoiceProfile(voiceProfile);
      
      console.log('LinkedIn ingestion completed successfully');
      return voiceProfile;
      
    } catch (error) {
      console.error('Error ingesting LinkedIn export:', error);
      throw error;
    }
  }

  private async extractZip(zipPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const extractedPath = zipPath.replace('.zip', '_extracted');
      
      yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
        if (err) {
          reject(err);
          return;
        }

        if (!fs.existsSync(extractedPath)) {
          fs.mkdirSync(extractedPath, { recursive: true });
        }

        zipfile.readEntry();
        zipfile.on('entry', (entry) => {
          if (/\/$/.test(entry.fileName)) {
            // Directory entry
            const dirPath = path.join(extractedPath, entry.fileName);
            if (!fs.existsSync(dirPath)) {
              fs.mkdirSync(dirPath, { recursive: true });
            }
            zipfile.readEntry();
          } else {
            // File entry
            zipfile.openReadStream(entry, (err, readStream) => {
              if (err) {
                reject(err);
                return;
              }

              const filePath = path.join(extractedPath, entry.fileName);
              const dir = path.dirname(filePath);
              
              if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
              }

              const writeStream = fs.createWriteStream(filePath);
              readStream.pipe(writeStream);
              
              writeStream.on('close', () => {
                zipfile.readEntry();
              });
            });
          }
        });

        zipfile.on('end', () => {
          resolve(extractedPath);
        });
      });
    });
  }

  private async parseLinkedInData(extractedPath: string): Promise<void> {
    const files = fs.readdirSync(extractedPath, { recursive: true }) as string[];
    
    for (const file of files) {
      const filePath = path.join(extractedPath, file);
      const stats = fs.statSync(filePath);
      
      if (stats.isFile() && this.isLinkedInContentFile(file)) {
        await this.parseContentFile(filePath, file);
      }
    }
  }

  private isLinkedInContentFile(filename: string): boolean {
    const contentFiles = [
      'Articles.csv',
      'Comments.csv',
      'Shares.csv',
      'Posts.csv',
      'articles.csv',
      'comments.csv',
      'shares.csv',
      'posts.csv'
    ];
    
    return contentFiles.some(pattern => filename.includes(pattern));
  }

  private async parseContentFile(filePath: string, filename: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const results: any[] = [];
      
      createReadStream(filePath)
        .pipe(csv())
        .on('data', (data: any) => {
          results.push(data);
        })
        .on('end', () => {
          this.processContentResults(results, filename);
          resolve();
        })
        .on('error', (error: any) => {
          reject(error);
        });
    });
  }

  private processContentResults(results: any[], filename: string): void {
    results.forEach((row, index) => {
      // LinkedIn export format can vary, so we need to handle different column names
      const text = this.extractTextFromRow(row);
      const date = this.extractDateFromRow(row);
      const url = this.extractUrlFromRow(row);
      
      if (text && text.length > 50) { // Only include substantial content
        const kind = this.determineContentKind(filename, row);
        
        this.extractedContent.push({
          text: this.cleanText(text),
          date: date || new Date().toISOString(),
          url: url || '',
          kind,
          source: filename,
        });
      }
    });
  }

  private extractTextFromRow(row: any): string {
    // Try different possible column names for content
    const possibleColumns = [
      'Content', 'Text', 'Body', 'Message', 'Description', 'Comment', 'Post',
      'content', 'text', 'body', 'message', 'description', 'comment', 'post'
    ];
    
    for (const col of possibleColumns) {
      if (row[col] && typeof row[col] === 'string') {
        return row[col];
      }
    }
    
    return '';
  }

  private extractDateFromRow(row: any): string {
    const possibleColumns = [
      'Date', 'Created Date', 'Posted Date', 'Timestamp', 'Time',
      'date', 'created_date', 'posted_date', 'timestamp', 'time'
    ];
    
    for (const col of possibleColumns) {
      if (row[col]) {
        return row[col];
      }
    }
    
    return '';
  }

  private extractUrlFromRow(row: any): string {
    const possibleColumns = [
      'URL', 'Link', 'Permalink', 'Post URL', 'Article URL',
      'url', 'link', 'permalink', 'post_url', 'article_url'
    ];
    
    for (const col of possibleColumns) {
      if (row[col]) {
        return row[col];
      }
    }
    
    return '';
  }

  private determineContentKind(filename: string, row: any): 'article' | 'post' | 'comment' | 'share' {
    const lowerFilename = filename.toLowerCase();
    
    if (lowerFilename.includes('article')) {
      return 'article';
    } else if (lowerFilename.includes('comment')) {
      return 'comment';
    } else if (lowerFilename.includes('share')) {
      return 'share';
    } else {
      return 'post';
    }
  }

  private cleanText(text: string): string {
    return text
      .replace(/\n+/g, ' ') // Replace multiple newlines with single space
      .replace(/\s+/g, ' ') // Replace multiple spaces with single space
      .replace(/https?:\/\/[^\s]+/g, '') // Remove URLs
      .replace(/#\w+/g, '') // Remove hashtags
      .replace(/@\w+/g, '') // Remove mentions
      .trim();
  }

  private buildVoiceProfile(): VoiceProfile {
    const allText = this.extractedContent.map(c => c.text).join(' ');
    
    // Analyze lexicon
    const lexicon = this.analyzeLexicon(allText);
    
    // Analyze cadence
    const cadence = this.analyzeCadence(this.extractedContent);
    
    // Analyze tone (simplified)
    const toneSliders = this.analyzeTone(allText);
    
    // Identify signature moves
    const signatureMoves = this.identifySignatureMoves(this.extractedContent);

    return {
      lexicon,
      cadence,
      toneSliders,
      signatureMoves,
    };
  }

  private analyzeLexicon(text: string): VoiceProfile['lexicon'] {
    // Simple pattern matching for common phrases
    const commonOpeners = this.findPatterns(text, [
      /(Happy to|Glad to|Excited to|Pleased to)/gi,
      /(Two quick|Three quick|A few quick)/gi,
      /(If helpful|If useful|If relevant)/gi,
    ]);

    const commonClosers = this.findPatterns(text, [
      /(Let me know|Feel free to|Happy to help|Hope this helps)/gi,
      /(Best regards|Thanks|Thank you|Cheers)/gi,
    ]);

    const signOffs = this.findPatterns(text, [
      /(Best|Cheers|Thanks|Regards)/gi,
    ]);

    const hedges = this.findPatterns(text, [
      /(I think|I believe|I feel|Perhaps|Maybe|Possibly)/gi,
    ]);

    const rhetoricalQuestions = this.findPatterns(text, [
      /(\?[^?]*\?)/g,
    ]);

    return {
      commonOpeners,
      commonClosers,
      signOffs,
      hedges,
      rhetoricalQuestions,
    };
  }

  private findPatterns(text: string, patterns: RegExp[]): string[] {
    const matches: string[] = [];
    
    patterns.forEach(pattern => {
      const found = text.match(pattern);
      if (found) {
        matches.push(...found.map(m => m.trim()));
      }
    });
    
    // Remove duplicates and return top 10 most common
    const counts = matches.reduce((acc, match) => {
      acc[match] = (acc[match] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    return Object.entries(counts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .map(([match]) => match);
  }

  private analyzeCadence(content: LinkedInContent[]): VoiceProfile['cadence'] {
    const sentences = content.map(c => c.text.split(/[.!?]+/)).flat();
    const paragraphs = content.map(c => c.text.split(/\n+/)).flat();
    
    const totalWords = content.reduce((sum, c) => sum + c.text.split(' ').length, 0);
    const totalSentences = sentences.length;
    const totalParagraphs = paragraphs.length;
    
    const bulletUsage = content.filter(c => c.text.includes('•') || c.text.includes('-')).length / content.length;

    return {
      averageSentenceLength: totalWords / totalSentences,
      averageParagraphCount: totalParagraphs / content.length,
      bulletUsage,
    };
  }

  private analyzeTone(text: string): VoiceProfile['toneSliders'] {
    // Simplified tone analysis
    const warmthWords = ['happy', 'excited', 'pleased', 'wonderful', 'great', 'love'];
    const directnessWords = ['directly', 'clearly', 'specifically', 'exactly', 'precisely'];
    const formalityWords = ['please', 'thank you', 'regards', 'sincerely', 'respectfully'];
    
    const warmth = this.calculateToneScore(text, warmthWords);
    const directness = this.calculateToneScore(text, directnessWords);
    const formality = this.calculateToneScore(text, formalityWords);

    return { warmth, directness, formality };
  }

  private calculateToneScore(text: string, words: string[]): number {
    const lowerText = text.toLowerCase();
    const matches = words.filter(word => lowerText.includes(word)).length;
    return Math.min(matches / words.length, 1);
  }

  private identifySignatureMoves(content: LinkedInContent[]): string[] {
    const moves: string[] = [];
    
    // Look for common patterns
    const startWithWhy = content.filter(c => 
      c.text.match(/^(Why|Because|The reason)/i)
    ).length / content.length;
    
    if (startWithWhy > 0.3) {
      moves.push('Start with a quick "why"');
    }
    
    const useBullets = content.filter(c => 
      c.text.includes('•') || c.text.includes('-')
    ).length / content.length;
    
    if (useBullets > 0.4) {
      moves.push('Use bullet points for clarity');
    }
    
    const endWithCTA = content.filter(c => 
      c.text.match(/(Let me know|Feel free|Get in touch)/i)
    ).length / content.length;
    
    if (endWithCTA > 0.5) {
      moves.push('End with clear call-to-action');
    }

    return moves;
  }

  private async indexVoiceContent(): Promise<void> {
    try {
      const voiceItems = this.extractedContent.map((content, index) => ({
        id: `linkedin_${index}`,
        text: content.text,
        meta: {
          date: content.date,
          url: content.url,
          kind: content.kind,
          source: content.source,
        },
      }));

      // await this.memoryClient.indexVoice(voiceItems);
      console.log(`Skipped Pinecone indexing for ${voiceItems.length} voice items`);
      
    } catch (error) {
      console.error('Error indexing voice content:', error);
      throw error;
    }
  }

  private async saveVoiceProfile(voiceProfile: VoiceProfile): Promise<void> {
    try {
      // TODO: Save to Notion voice pack database
      // await notionClient.upsertVoicePack({
      //   title: 'LinkedIn Voice Profile',
      //   content: JSON.stringify(voiceProfile, null, 2),
      //   source: 'LinkedIn',
      //   voiceElement: 'General',
      //   confidence: 0.9,
      //   tags: ['linkedin', 'voice_profile', 'initial'],
      //   wordCount: JSON.stringify(voiceProfile).split(' ').length,
      // });

      console.log('Voice profile saved to Notion');
      
    } catch (error) {
      console.error('Error saving voice profile:', error);
      throw error;
    }
  }
}

// CLI interface
async function main() {
  const zipPath = process.argv[2];
  
  if (!zipPath) {
    console.error('Usage: npm run ingest <path-to-linkedin-export.zip>');
    process.exit(1);
  }
  
  if (!fs.existsSync(zipPath)) {
    console.error(`File not found: ${zipPath}`);
    process.exit(1);
  }
  
  try {
    const ingester = new LinkedInIngester();
    const voiceProfile = await ingester.ingestLinkedInExport(zipPath);
    
    console.log('\n=== Voice Profile Generated ===');
    console.log(JSON.stringify(voiceProfile, null, 2));
    
  } catch (error) {
    console.error('Ingestion failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { LinkedInIngester, VoiceProfile, LinkedInContent };
