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

    // Amazon Scraping
    const amazonUrl = `https://www.amazon.com/s?k=${searchValue}`;
    await page.goto(amazonUrl, { waitUntil: 'domcontentloaded' });

    const amazonProducts = await page.evaluate(() => {
      const titleElements = Array.from(document.querySelectorAll('.a-section.a-spacing-none.a-spacing-top-small.s-title-instructions-style'))
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

    // Ebay Scraping
    const ebayUrl = `https://www.ebay.com/sch/i.html?_from=R40&_trksid=p4432023.m570.l1313&_nkw=${searchValue}&_sacat=0`;
    await page.goto(ebayUrl, { waitUntil: 'domcontentloaded' });

    const ebayPrices = await page.evaluate(() => {

      const items = Array.from(document.querySelectorAll('.s-item__wrapper.clearfix'));

      const pricesWithUrls = items.map(item => {
        const priceElement = item.querySelector('.s-item__price');
        const urlElement = item.querySelector('.s-item__link'); // Use link element for URL
        const brandNewElement = item.querySelector('.SECONDARY_INFO');

        // console.log(`Price element is ${priceElement}`)
        // console.log(`urlElement is ${urlElement}`)
        // console.log(`brandNewElement is ${brandNewElement}`)
        if (priceElement && urlElement && priceElement.textContent !=='20') {
          const priceText = priceElement.textContent?.trim();
          const price = priceText ? parseFloat(priceText.replace(/[^\d.-]/g, '')) : null;
          const url = urlElement.getAttribute('href');
          const isBrandNew = brandNewElement?.textContent?.includes('Brand New');

          return price !== null ? { price, url, isBrandNew } : null;
        }
        return null;
      });

      const validItems = pricesWithUrls.filter(item => item !== null && item.price !== 0 && item.price !== 20);

      const brandNewPrices = validItems.filter(item => item?.isBrandNew);
      const notNewPrices = validItems.filter(item => !item?.isBrandNew);

      return { brandNewPrices, notNewPrices };
    });

    const lowestBrandNewEbayPrice = ebayPrices.brandNewPrices.length > 0
    ? ebayPrices.brandNewPrices.reduce((lowest, item) => {
        if (!item || !lowest) return item || lowest;
        return item.price < lowest.price ? item : lowest;
      }, null)
    : null;

    const lowestNotNewEbayPrice = ebayPrices.notNewPrices.length > 0
      ? ebayPrices.notNewPrices.reduce((lowest, item) => {
          if (!item || !lowest) return item || lowest;
          return item.price < lowest.price ? item : lowest;
        }, null)
      : null;

    const guitarCenterUrl = `https://www.guitarcenter.com/search?typeAheadSuggestion=true&fromRecentHistory=false&Ntt=ax-edge`;
    await page.goto(guitarCenterUrl, { waitUntil: 'domcontentloaded' });

    // page.on('console', async (msg) => {
    //   const msgArgs = msg.args();
    //   for (let i = 0; i < msgArgs.length; ++i) {
    //     console.log(await msgArgs[i].jsonValue());
    //   }
    // });
    const guitarPrices = await page.evaluate(() => {

      const listings = Array.from(document.querySelectorAll('.product-item'));

      const itemsWithoutCondition: { title: string; price: string; url: string | null | undefined }[] = [];
      const itemsWithCondition: { title: string; price: string; condition: string; url: string | null | undefined  }[] = [];

      listings.forEach(listing => {
        const title = listing.querySelector('h2')?.innerText.trim(); // Safe access with optional chaining
        const price = listing.querySelector('.sale-price')?.textContent?.trim();
        const condition = listing.querySelector('p.font-normal.mb-2.text-xs')?.textContent?.trim();
        const url = listing.querySelector('.product-name')?.getAttribute('href')

        if (!title || !price || title.includes("With")) {
          return;
        }

        if (!condition) {
          itemsWithoutCondition.push({ title, price, url });
        } else {
          itemsWithCondition.push({ title, price, condition, url });
        }
      });

      return { itemsWithoutCondition, itemsWithCondition };
    });

    const { itemsWithoutCondition, itemsWithCondition } = guitarPrices;

    const calculateLowestPriceWithUrl = (items: any[]) => {
      return items.reduce((lowest, item) => {
        if (item) {
          const priceText = item.price.replace(/[^\d.-]/g, '');
          const price = parseFloat(priceText);

          if (isNaN(price)) return lowest;

          if (!lowest || price < lowest.price) {
            return { price, url: item.url };
          }
        }
        return lowest;
      }, null);
    };

    const lowestGuitarPriceWithoutCondition = calculateLowestPriceWithUrl(itemsWithoutCondition);
    const lowestGuitarPriceWithCondition = calculateLowestPriceWithUrl(itemsWithCondition);

    const finalPriceWithoutCondition = lowestGuitarPriceWithoutCondition
      ? { price: lowestGuitarPriceWithoutCondition.price.toString(), url: lowestGuitarPriceWithoutCondition.url }
      : { price: 'No price available', url: null };

    const finalPriceWithCondition = lowestGuitarPriceWithCondition
      ? { price: lowestGuitarPriceWithCondition.price.toString(), url: lowestGuitarPriceWithCondition.url }
      : { price: 'No price available', url: null };

    const perfectUrl = `https://www.aliexpress.us/w/wholesale-roland-ax%2525252dedge.html?spm=a2g0o.detail.search.0`;
    // console.log(`Navigating to Kraft URL: ${perfectUrl}`);

    await page.goto(perfectUrl, { waitUntil: 'domcontentloaded' });

    const aliExpressPrices = await page.evaluate(() => {

      const listings = Array.from(document.querySelectorAll('.multi--modalContext--1Hxqhwi'));

      const listingsArray = listings
        .map(listing => {
          const title = listing.querySelector('h3')
          const titleText = title?.textContent
          const url = listing.querySelector('.search-card-item')?.getAttribute('href')
          const priceElements = Array.from(listing.querySelectorAll('.multi--price-sale--U-S0jtj span'));
          const priceText = priceElements.map(el => el.textContent).join(''); // Join the text content of each span to form the full price
          priceText.trim()

          if (!titleText?.includes("Roland Synthesizer")){
            return null
          }

          return {titleText, priceText, url};
        })
        .filter(item => item !== null);

      return listingsArray;
    });

    const lowestAliExpressPrice = aliExpressPrices
    .map(item => {
      if (item) {
        const priceTexts = item.priceText.replace(/[^\d.-]/g, '');
        const price = parseFloat(priceTexts);
        return { price: isNaN(price) ? null : price, url: item.url };
      }
      return null;
    })
    .reduce<{ price: number | null; url: string | null | undefined } | null>((lowest, current) => {
      if (current && current.price !== null) {
        if (lowest === null || (lowest.price !== null && current.price < lowest.price)) {
          return current;
        }
      }
      return lowest;
    }, null);

  const finalAliExpressPrice = lowestAliExpressPrice?.price || 0;
  const finalAliExpressUrl = lowestAliExpressPrice?.url ?? 'No URL available';

  await browser.close();


  const priceList = [
    { price: parseFloat(lowestAmazonPrice.replace(/[^\d.-]/g, '')) || NaN, url: amazonProducts[0]?.fullUrl },
    { price: lowestBrandNewEbayPrice?.price || NaN, url: lowestBrandNewEbayPrice?.url },
    { price: parseFloat(finalPriceWithoutCondition.price.replace(/[^\d.-]/g, '')) || NaN, url: "https://www.guitarcenter.com" + finalPriceWithoutCondition.url },
    { price: (finalAliExpressPrice) || NaN, url: finalAliExpressUrl }
  ];


  const validPrices = priceList.filter(item => !isNaN(item.price));

  const lowestPrice = Math.min(...validPrices.map(item => item.price));
  const lowestPriceItem = validPrices.find(item => item.price === lowestPrice);
  const lowestPriceUrl = lowestPriceItem ? lowestPriceItem.url : null;

    return res.json({
      results: amazonProducts,
      lowestAmazonPrice: lowestAmazonPrice,
      lowestBrandNewEbayPrice: lowestBrandNewEbayPrice,
      lowestBrandNewEbayURL: lowestBrandNewEbayPrice?.url,
      lowestNotNewEbayPrice: lowestNotNewEbayPrice,
      lowestNotNewEbayURL: lowestNotNewEbayPrice?.url,
      lowestGuitarPrice: finalPriceWithoutCondition.price,
      lowestGuitarURL: "https://www.guitarcenter.com" + finalPriceWithoutCondition.url,
      lowestNotNewGuitarPrice: lowestGuitarPriceWithCondition,
      lowestNotNewGuitarUrl: "https://www.guitarcenter.com" + finalPriceWithCondition.url,
      lowestAliExpressPrice: finalAliExpressPrice,
      lowestAliExpressURL: finalAliExpressUrl,
      bestPrice: lowestPrice,
      bestPriceURL: lowestPriceUrl


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
