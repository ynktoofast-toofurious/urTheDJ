import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { uploadToS3 } from './s3-upload';

export async function downloadYouTubeMp3(youtubeUrl: string): Promise<string> {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto('https://yt2mp3.gs/', { waitUntil: 'networkidle2' });
    await page.type('input[name="url"]', youtubeUrl);
    await page.click('button[type="submit"]');
    await page.waitForSelector('.download-button a', { timeout: 60000 });
    const downloadUrl = await page.$eval('.download-button a', el => (el as HTMLAnchorElement).href);
    // Download the MP3 file
    const res = await page.goto(downloadUrl);
    const buffer = await res?.buffer();
    if (!buffer) throw new Error('Failed to download MP3');
    const filename = `yt-${Date.now()}.mp3`;
    const tempPath = path.join('/tmp', filename);
    fs.writeFileSync(tempPath, buffer);
    // Upload to S3
    const s3Url = await uploadToS3(tempPath, filename);
    fs.unlinkSync(tempPath);
    await browser.close();
    return s3Url;
  } catch (err) {
    await browser.close();
    throw err;
  }
}
