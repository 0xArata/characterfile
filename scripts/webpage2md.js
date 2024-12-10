#!/usr/bin/env node

import dotenv from 'dotenv';
import axios from 'axios';
import { promises as fs } from 'fs';
import path from 'path';
import { URL } from 'url';
import readline from 'readline';
import os from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import cliProgress from 'cli-progress';
import chalk from 'chalk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BASE_URL = 'https://md.dhr.wtf/';
const OUTPUT_DIR = './knowledge';
const tmpDir = path.join(os.homedir(), 'tmp', '.eliza');
const envPath = path.join(tmpDir, '.env');

// Ensure the tmp directory and .env file exist
const ensureTmpDirAndEnv = async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    if (!await fs.access(envPath).then(() => true).catch(() => false)) {
        await fs.writeFile(envPath, '');
    }
};

const saveApiKey = async (apiKey) => {
    const envConfig = dotenv.parse(await fs.readFile(envPath, 'utf-8'));
    envConfig.MARKDOWNER_API_KEY = apiKey;
    await fs.writeFile(envPath, Object.entries(envConfig).map(([key, value]) => `${key}=${value}`).join('\n'));
};

const loadApiKey = async () => {
    const envConfig = dotenv.parse(await fs.readFile(envPath, 'utf-8'));
    return envConfig.MARKDOWNER_API_KEY;
};

const validateApiKey = (apiKey) => {
    return apiKey && apiKey.trim().length > 0;
};

const question = (rl, query) => new Promise((resolve) => rl.question(query, resolve));

const promptForApiKey = async () => {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const apiKey = await question(rl, 'Enter your Markdowner API key: ');
    rl.close();
    return apiKey;
};

const getApiKey = async () => {
    if (validateApiKey(process.env.MARKDOWNER_API_KEY)) {
        return process.env.MARKDOWNER_API_KEY;
    }

    const cachedKey = await loadApiKey();
    if (validateApiKey(cachedKey)) {
        return cachedKey;
    }

    const newKey = await promptForApiKey();
    if (validateApiKey(newKey)) {
        await saveApiKey(newKey);
        return newKey;
    } else {
        console.error('Invalid API key provided. Exiting.');
        process.exit(1);
    }
};

const promptForOptions = async () => {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const getBooleanInput = async (query) => {
        const answer = await question(rl, `${query} (y/n): `);
        return answer.toLowerCase().startsWith('y');
    };

    const getNumberInput = async (query, defaultValue) => {
        const answer = await question(rl, `${query} (default: ${defaultValue}): `);
        return answer ? parseInt(answer) : defaultValue;
    };

    const getUrlInput = async (query) => {
        const answer = await question(rl, query);
        try {
            new URL(answer);
            return answer;
        } catch {
            console.log('Invalid URL. Please try again.');
            return getUrlInput(query);
        }
    };

    const getMode = async () => {
        console.log('\nSelect processing mode:');
        console.log('1. Single URL');
        console.log('2. Multiple URLs');
        console.log('3. Crawl Website');
        const mode = await question(rl, 'Choose mode (1-3): ');
        return parseInt(mode);
    };

    const options = {
        enableDetailedResponse: await getBooleanInput('Enable detailed response?'),
        crawlSubpages: await getBooleanInput('Enable crawling subpages?'),
        llmFilter: await getBooleanInput('Enable LLM filtering?'),
        cleanupContent: await getBooleanInput('Enable content cleanup?'),
        mode: await getMode()
    };

    if (options.crawlSubpages) {
        options.maxDepth = await getNumberInput('Enter maximum crawl depth', 1);
    }

    switch (options.mode) {
        case 1:
            options.url = await getUrlInput('Enter the URL to process: ');
            break;
        case 2:
            const urlCount = await getNumberInput('How many URLs do you want to process?', 1);
            options.urls = [];
            for (let i = 0; i < urlCount; i++) {
                const url = await getUrlInput(`Enter URL ${i + 1}: `);
                options.urls.push(url);
            }
            break;
        case 3:
            options.startUrl = await getUrlInput('Enter the starting URL for crawling: ');
            break;
    }

    rl.close();
    return options;
};

class WebpageToMarkdown {
    constructor(options = {}) {
        this.apiKey = process.env.MARKDOWNER_API_KEY;
        this.options = {
            enableDetailedResponse: options.enableDetailedResponse || false,
            crawlSubpages: options.crawlSubpages || false,
            llmFilter: options.llmFilter || false,
            maxDepth: options.maxDepth || 1,
            cleanupContent: options.cleanupContent || true
        };
        this.progressBar = new cliProgress.SingleBar({
            format: '{bar} {percentage}% | {value}/{total} files | {file}',
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
        }, cliProgress.Presets.shades_classic);
        this.processedUrls = new Set();
    }

    isValidFileType(url) {
        const extension = path.extname(url).toLowerCase();
        const invalidExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.css', '.js'];
        return !invalidExtensions.includes(extension);
    }

    async processUrl(url, retries = 3) {
        if (!this.isValidFileType(url)) {
            console.log(chalk.yellow(`Skipping non-document file: ${url}`));
            return null;
        }

        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const params = new URLSearchParams({
                    url: url,
                    enableDetailedResponse: this.options.enableDetailedResponse,
                    crawlSubpages: this.options.crawlSubpages,
                    llmFilter: this.options.llmFilter,
                    apiKey: this.apiKey
                });

                console.log(chalk.blue('\nAttempting to fetch URL:'), url);
                
                // Add random delay between attempts to avoid rate limiting
                if (attempt > 1) {
                    const delay = Math.floor(Math.random() * 3000) + (attempt * 2000);
                    console.log(chalk.yellow(`Adding random delay of ${delay}ms...`));
                    await new Promise(resolve => setTimeout(resolve, delay));
                }

                const response = await axios.get(`${BASE_URL}?${params}`, {
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.5',
                        'Accept-Encoding': 'gzip, deflate, br',
                        'Cache-Control': 'no-cache',
                        'Pragma': 'no-cache',
                        'Sec-Fetch-Dest': 'document',
                        'Sec-Fetch-Mode': 'navigate',
                        'Sec-Fetch-Site': 'none',
                        'Sec-Fetch-User': '?1',
                        'Upgrade-Insecure-Requests': '1',
                        'X-Requested-With': 'XMLHttpRequest',
                        'Referer': url,
                        'Origin': new URL(url).origin
                    },
                    timeout: 60000,  // Increased timeout to 60 seconds
                    validateStatus: function (status) {
                        return status < 500; // Resolve only if the status code is less than 500
                    },
                    maxRedirects: 5,
                    decompress: true,
                    // Add proxy support if needed
                    // proxy: {
                    //     protocol: 'http',
                    //     host: '127.0.0.1',
                    //     port: 8080
                    // }
                });

                if (response.status !== 200) {
                    console.log(chalk.yellow('Response status:'), response.status);
                    console.log(chalk.yellow('Response headers:'), response.headers);
                    if (response.data) {
                        console.log(chalk.yellow('Response data:'), response.data);
                    }

                    // Check for Cloudflare specific headers
                    if (response.headers['cf-ray']) {
                        console.log(chalk.yellow('Cloudflare Ray ID:'), response.headers['cf-ray']);
                        if (response.status === 429 || response.status === 503) {
                            throw new Error('Cloudflare rate limiting detected');
                        }
                    }
                }

                return response.data;
            } catch (error) {
                const isLastAttempt = attempt === retries;
                if (error.response) {
                    console.error(chalk.red('Response error:'), {
                        status: error.response.status,
                        headers: error.response.headers,
                        data: error.response.data
                    });

                    // Handle specific Cloudflare errors
                    if (error.response.headers['cf-ray']) {
                        const waitTime = attempt * 5000; // Longer wait for Cloudflare issues
                        console.warn(chalk.yellow(`Cloudflare detected, waiting ${waitTime}ms before retry...`));
                        await new Promise(resolve => setTimeout(resolve, waitTime));
                        continue;
                    }
                } else if (error.request) {
                    console.error(chalk.red('Request error:'), error.message);
                } else {
                    console.error(chalk.red('Error:'), error.message);
                }

                if (isLastAttempt) {
                    console.error(chalk.red(`Error processing URL ${url} after ${retries} attempts:`, error.message));
                    throw error;
                } else {
                    console.warn(chalk.yellow(`Attempt ${attempt}/${retries} failed for ${url}. Retrying...`));
                    await new Promise(resolve => setTimeout(resolve, attempt * 2000));
                }
            }
        }
    }

    async saveToFile(content, url) {
        try {
            const parsedUrl = new URL(url);
            const domain = parsedUrl.hostname;
            
            // Create path parts from URL
            const urlPath = parsedUrl.pathname.slice(1); // Remove leading slash
            const pathParts = urlPath.split('/').filter(part => part); // Remove empty parts
            const filename = pathParts.pop() || 'index';
            
            // Normalize filename
            const normalizedFilename = filename
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '_') // Replace non-alphanumeric with underscore
                .replace(/^_+|_+$/g, ''); // Remove leading/trailing underscores
            
            // Create nested directory structure
            const dirPath = path.join(OUTPUT_DIR, domain, ...pathParts);
            await fs.mkdir(dirPath, { recursive: true });
            
            const filePath = path.join(dirPath, `${normalizedFilename}.md`);
            await fs.writeFile(filePath, content);
            
            return filePath;
        } catch (error) {
            console.error(chalk.red('Error saving file:', error));
            throw error;
        }
    }

    async processSingleUrl(url) {
        const content = await this.processUrl(url);
        if (content) {
            const cleanContent = this.cleanupMarkdown(content);
            const savedPath = await this.saveToFile(cleanContent, url);
            return savedPath;
        }
        return null;
    }

    async processUrlList(urls) {
        console.log(chalk.blue('\nProcessing URLs...'));
        const uniqueUrls = [...new Set(urls)];
        this.progressBar.start(uniqueUrls.length, 0, { file: 'Starting...' });
        
        const results = [];
        for (const url of uniqueUrls) {
            try {
                this.progressBar.update(results.length, { file: url });
                const savedPath = await this.processSingleUrl(url);
                results.push({ 
                    url, 
                    path: savedPath, 
                    success: Boolean(savedPath)
                });
            } catch (error) {
                results.push({ 
                    url, 
                    error: error.message, 
                    success: false 
                });
            }
            this.progressBar.increment();
        }
        
        this.progressBar.stop();
        this.printSummary(results);
        return results;
    }

    async crawlWebsite(startUrl, depth = 1) {
        console.log(chalk.blue(`\nCrawling website starting from: ${startUrl}`));
        this.processedUrls = new Set();
        const queue = [{ url: startUrl, depth: 0 }];
        const results = [];

        // Start with a small initial estimate
        this.progressBar.start(1, 0, { file: 'Starting...' });

        while (queue.length > 0) {
            const { url, depth: currentDepth } = queue.shift();
            
            if (this.processedUrls.has(url) || currentDepth > depth) continue;
            this.processedUrls.add(url);

            try {
                this.progressBar.update(this.processedUrls.size - 1, { file: url });
                const content = await this.processUrl(url);
                if (content) {
                    const cleanContent = this.cleanupMarkdown(content);
                    const savedPath = await this.saveToFile(cleanContent, url);
                    results.push({ url, path: savedPath, success: true });

                    if (this.options.crawlSubpages && currentDepth < this.options.maxDepth) {
                        const links = this.extractLinks(content, url);
                        const newLinks = links.filter(link => !this.processedUrls.has(link));
                        
                        // Update total in progress bar when we find new links
                        if (newLinks.length > 0) {
                            const newTotal = this.processedUrls.size + newLinks.length;
                            this.progressBar.setTotal(newTotal);
                        }

                        newLinks.forEach(link => {
                            if (this.isValidFileType(link)) {
                                queue.push({ url: link, depth: currentDepth + 1 });
                            }
                        });
                    }
                }
            } catch (error) {
                results.push({ url, error: error.message, success: false });
            }
            this.progressBar.increment();
        }

        this.progressBar.stop();
        this.printSummary(results);
        return results;
    }

    printSummary(results) {
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;
        const skipped = results.filter(r => r.success === null).length;
        
        console.log('\nProcessing Summary:');
        console.log(chalk.green(`✓ Successfully processed: ${successful}`));
        console.log(chalk.red(`✗ Failed: ${failed}`));
        if (skipped > 0) {
            console.log(chalk.yellow(`⚠ Skipped: ${skipped}`));
        }
        
        if (failed > 0) {
            console.log('\nFailed URLs:');
            results.filter(r => !r.success && r.error)
                .forEach(r => console.log(chalk.red(`- ${r.url}: ${r.error}`)));
        }
    }

    cleanupMarkdown(content) {
        if (!content || typeof content !== 'string') return '';

        // Split content into lines
        let lines = content.split('\n');

        // Get the title (first line)
        const title = lines[0];

        // Find the first h1 heading (line starting with single #)
        const contentStartIndex = lines.findIndex(line => 
            line.trim().match(/^# [^#]/)  // Matches # followed by space and any non-# character
        );

        // Find Pager if it exists (case insensitive)
        const pagerIndex = lines.findIndex(line => 
            line.trim().toLowerCase().includes('pager')
        );

        // Get content
        let contentLines = [];
        if (contentStartIndex !== -1) {
            // If Pager exists, get content up to it, otherwise get until the end
            const endIndex = pagerIndex !== -1 ? pagerIndex : lines.length;
            contentLines = lines.slice(contentStartIndex, endIndex);
        }

        // Clean up the content
        let cleanedContent = [
            title,  // Keep the original title
            '',     // Add a blank line after title
            ...contentLines
        ].join('\n');

        // Enhanced cleanup
        cleanedContent = cleanedContent
            // Clean markdown links while preserving text and tokens
            .replace(/\[`([^`]+)`\]\([^)]+\)/g, '$1')
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
            // Remove image markdown more aggressively
            .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
            .replace(/\[\s*!\[[^\]]*\][^\]]*\]\([^)]+\)/g, '')  // Nested image links
            .replace(/^!.*$/gm, '')  // Remove standalone image references
            // Remove multiple consecutive empty lines
            .replace(/\n{3,}/g, '\n\n')
            // Remove lines that are just whitespace or single characters
            .replace(/^\s*[\s\u200b\u200c\u200d\ufeff]?\s*$/gm, '')
            // Remove empty sections (heading followed immediately by another heading)
            .replace(/^(#+\s[^\n]+)\n+(?=#+\s)/gm, '$1\n')
            // Clean up emoji and special characters (but keep basic emojis)
            .replace(/[\u200b\u200c\u200d\ufeff​]/g, '')
            // Format TIP sections
            .replace(/^TIP\s*$/gm, '\n> **Note**')
            // Format token symbols consistently
            .replace(/\$([A-Z]+)/g, '`$$$1`')
            // Fix code block language annotations
            .replace(/^(\w+)\n\n?```\n/gm, '```$1\n')
            .replace(/^(\w+)\n\n?```(\w+)\n/gm, '```$2\n')
            // Improve blockquote formatting
            .replace(/^>\s*/gm, '\n> ')
            .replace(/(?<!^)>\s*/gm, '> ')
            // Remove empty lines at start and end
            .trim()
            // Ensure only single line break between sections
            .replace(/\n\s*\n/g, '\n\n')
            // Clean up numbered lists (ensure proper spacing)
            .replace(/^(\d+\.\s+)/gm, '\n$1')
            .replace(/\n{3,}/g, '\n\n')  // Clean up any triple newlines created
            // Clean up bullet points (ensure proper spacing)
            .replace(/^(\s*[-*]\s+)/gm, '\n$1')
            .replace(/\n{3,}/g, '\n\n')  // Clean up any triple newlines created
            // Final cleanup of excessive newlines around blockquotes
            .replace(/\n{2,}(>)/g, '\n\n$1')
            .replace(/(>.*\n)\n{2,}/g, '$1\n');

        return cleanedContent;
    }

    extractLinks(content, baseUrl) {
        const linkRegex = /\[.*?\]\((.*?)\)/g;
        const links = new Set();
        let match;

        while ((match = linkRegex.exec(content)) !== null) {
            try {
                const url = new URL(match[1], baseUrl);
                if (url.hostname === new URL(baseUrl).hostname && this.isValidFileType(url.href)) {
                    links.add(url.href);
                }
            } catch (error) {
                continue;
            }
        }

        return Array.from(links);
    }

    async cleanupExistingFile(filePath) {
        try {
            console.log(chalk.blue(`Processing file: ${filePath}`));
            
            // Read the file content
            const content = await fs.readFile(filePath, 'utf-8');
            
            // Clean up the content
            const cleanedContent = this.cleanupMarkdown(content);
            
            // Write back to the same file
            await fs.writeFile(filePath, cleanedContent);
            
            console.log(chalk.green(`Successfully cleaned up: ${filePath}`));
            return true;
        } catch (error) {
            console.error(chalk.red(`Error processing file ${filePath}:`, error.message));
            return false;
        }
    }

    async cleanupDirectory(dirPath) {
        try {
            console.log(chalk.blue(`\nProcessing directory: ${dirPath}`));
            
            // Get all markdown files recursively
            const getFiles = async (dir) => {
                const entries = await fs.readdir(dir, { withFileTypes: true });
                const files = await Promise.all(entries.map(async (entry) => {
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        return getFiles(fullPath);
                    } else if (entry.name.endsWith('.md')) {
                        return fullPath;
                    }
                    return [];
                }));
                return files.flat();
            };

            const files = await getFiles(dirPath);
            console.log(chalk.blue(`Found ${files.length} markdown files`));

            // Setup progress bar
            this.progressBar.start(files.length, 0);
            
            // Process each file
            const results = [];
            for (const file of files) {
                const success = await this.cleanupExistingFile(file);
                results.push({ file, success });
                this.progressBar.increment();
            }
            
            this.progressBar.stop();
            
            // Print summary
            console.log(chalk.green('\nCleanup complete!'));
            console.log(chalk.blue('Summary:'));
            console.log(`Total files: ${results.length}`);
            console.log(`Successful: ${results.filter(r => r.success).length}`);
            console.log(`Failed: ${results.filter(r => !r.success).length}`);
            
            return results;
        } catch (error) {
            console.error(chalk.red('Error processing directory:', error.message));
            throw error;
        }
    }
}

async function main() {
    try {
        await ensureTmpDirAndEnv();
        const apiKey = await getApiKey();
        process.env.MARKDOWNER_API_KEY = apiKey;

        const options = await promptForOptions();
        const converter = new WebpageToMarkdown(options);

        switch (options.mode) {
            case 1:
                const result = await converter.processSingleUrl(options.url);
                console.log('Saved to:', result);
                break;
            case 2:
                const results = await converter.processUrlList(options.urls);
                console.log('Results:', results);
                break;
            case 3:
                const crawlResults = await converter.crawlWebsite(options.startUrl, options.maxDepth);
                console.log('Crawl results:', crawlResults);
                break;
        }
    } catch (error) {
        console.error('Error during execution:', error);
        process.exit(1);
    }
}

main().catch(console.error);

export default WebpageToMarkdown; 