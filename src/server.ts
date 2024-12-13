import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import puppeteer from 'puppeteer';
import bodyParser from 'body-parser';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

app.use(bodyParser.json());
/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

app.post('/scrape', async (req, res) => {

  const { searchValue } = req.body;
  if (!searchValue) {
    return res.status(400).json({ error: 'Missing search value' });
  }

  try {
    const browser = await puppeteer.launch();

    const page = await browser.newPage();

    const amazonUrl = `https://www.amazon.com/s?k=${searchValue}`;
    await page.goto(amazonUrl, { waitUntil: 'domcontentloaded' });

    page.on('console', async (msg) => {
      const msgArgs = msg.args();
      for (let i = 0; i < msgArgs.length; ++i) {
        console.log(await msgArgs[i].jsonValue());
      }
    });
    const amazonProducts = await page.evaluate(() => {
      const titleElements = Array.from(document.querySelectorAll('div[data-cy="title-recipe"] h2 span'));
      const imageElements = Array.from(document.querySelectorAll('div.a-section.aok-relative.s-image-square-aspect img'));
      const priceElements = Array.from(document.querySelectorAll('.a-price .a-offscreen'));
      const buyLink = document.querySelector('a.a-link-normal.s-line-clamp-4.s-link-style.a-text-normal')?.getAttribute('href');

      return titleElements.map((item, index) => {
        const title = item?.textContent?.trim() || 'No title available';
        const imageUrl = imageElements[index]?.getAttribute('src') || 'No image available';
        const price = priceElements[index]?.textContent?.trim() || 'No price available';
        const fullUrl = buyLink ? `https://www.amazon.com${buyLink}` : null;

        if (!title.includes("Roland")) {
          return null;
        }

        return { title, imageUrl, price, fullUrl };
      });
    });


      const validAmazonProducts = amazonProducts.filter(product => product !== null);
      const amazonPrices = validAmazonProducts.map(product => {

        const priceText = product?.price.replace(/[^\d.-]/g, '');
        return parseFloat(priceText ? priceText: '');
      }).filter(price => !isNaN(price));

      const lowestAmazonPrice = amazonPrices.length > 0
        ? Math.min(...amazonPrices).toString()
        : 'No price available';

    return res.json({
      results: amazonProducts,
      lowestAmazonPrice: lowestAmazonPrice
    })

  } catch (error) {
    console.error('Error during web scraping:', error);
    return res.status(500).json({ error: 'Web scraping failed' });
  }
})


/**
 * Handle all other requests by rendering the Angular application.
 */
app.use('/**', (req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url)) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, () => {
    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * The request handler used by the Angular CLI (dev-server and during build).
 */
export const reqHandler = createNodeRequestHandler(app);
