# Inbox Scout - AI-Powered Email Management Service

A sophisticated AI-powered inbox management system built with MCP (Model Context Protocol), Notion integration, and Pinecone vector memory. This instance is configured for **Amy** at my@alignedtribe.com.

## ðŸŽ¯ What This Does for Amy

- **Morning Digest**: Daily 7:30 AM Sydney time email with draft replies ready to review
- **Smart Drafts**: AI creates Outlook reply drafts based on Amy's voice and style
- **Voice Learning**: Learns from Amy's LinkedIn content and email edits to match her style
- **Contact Management**: Tracks interactions and builds knowledge base in Notion
- **No Auto-Send**: Amy reviews and sends all replies manually (for now)

## ðŸ—ï¸ Architecture

### Packages
- **mcp-outlook**: Microsoft Graph API integration (Office 365)
- **mcp-notion**: Notion API for contact management and interaction tracking  
- **memory-pinecone**: Vector database for email content indexing and voice learning
- **ingest-linkedin**: LinkedIn profile parsing and voice pack creation
- **agent-service**: Core AI agent orchestration using AgentKit

### Services
- **digest**: Daily 7:30 AM Sydney time email digest with Notion + Outlook links
- **sent-monitor**: Real-time monitoring of sent emails with voice/style updates

## ðŸš€ Quick Start

1. Copy .env.example to .env
2. Fill in your API credentials (see setup guide below)
3. Run pnpm install
4. Run pnpm dev

## ðŸ”§ Setup Guide

### 1. Microsoft Graph API (Office 365)
- Create Azure App Registration
- Add Graph scopes: Mail.ReadWrite, Mail.Send
- Use delegated permissions for Amy's mailbox

### 2. Notion Setup
- Create workspace for Amy
- Set up databases: Contacts, Drafts, Knowledge Base, Interactions
- Generate API key

### 3. Pinecone Setup
- Create Pinecone account
- Set up index: inbox-scout-amy-memory
- Configure namespaces: oice, emails, 
otes, kb

### 4. LinkedIn Voice Pack
- Amy exports her LinkedIn data (Settings â†’ Privacy â†’ Get a copy)
- Run pnpm ingest-linkedin with the ZIP file
- System builds voice profile from her posts, articles, comments

## ðŸ³ Railway Deployment

This is configured for Railway deployment:

`ash
# Deploy to Railway
railway login
railway link
railway up
`

## ðŸ”„ Future Client Replication

This repository serves as a template for creating inbox management services for other clients:

1. **Fork this repository**
2. **Update client config** in .env:
   - CLIENT_NAME, CLIENT_EMAIL, CLIENT_DOMAIN
   - PINECONE_INDEX_NAME (include client identifier)
3. **Deploy with client's API credentials**
4. **Set up their LinkedIn voice pack**

### Multi-Client Architecture
- Each client gets their own Railway service
- Separate Pinecone indexes per client
- Shared codebase with client-specific configurations
- Docker containers isolate client environments

## ðŸŽ›ï¸ Amy's Voice Profile

Based on the provided specifications:
- **Tone**: Warm, direct, confident; plain English; no emojis
- **Cadence**: 2-4 short paragraphs; bullets OK; avoid walls of text
- **Signature moves**: Start with 1-sentence why, address one concern, give 1 clear next step
- **Phrases to favor**: "Happy toâ€¦", "Two quick optionsâ€¦", "If helpful, I canâ€¦"
- **Phrases to avoid**: "Per my lastâ€¦", "Kindlyâ€¦"
- **Length**: â‰¤180 words unless explicitly asked for detail

## ðŸ“Š Monitoring & Alerts

- Service health monitoring via Railway
- Email digest delivery confirmation
- Voice learning progress tracking
- Alert webhook for service issues

## ðŸ”’ Security Notes

- All API keys stored as Railway environment variables
- No auto-sending of customer emails (Amy reviews all)
- Minimal data retention outside Notion/Pinecone
- Office 365 delegated permissions (no admin access needed)

---

**Built by Aaron for Amy** â¤ï¸
*Future state: Automated client onboarding via Airtable + GitHub Actions*
