const express = require('express');
const { shopifyApp } = require('@shopify/shopify-app-express');
const { PrismaSessionStorage } = require('@shopify/shopify-app-session-storage-prisma');
const { PrismaClient } = require('@prisma/client');
const { ApiVersion } = require('@shopify/shopify-api');
const next = require('next');
const path = require('path');
require('dotenv').config();

const PORT = process.env.PORT || 3000;
const isDevelopment = process.env.NODE_ENV !== 'production';

// Initialize Prisma client
const prisma = new PrismaClient();

// Initialize Next.js
const nextApp = next({ dev: isDevelopment });
const handle = nextApp.getRequestHandler();

// Shopify app configuration
const shopify = shopifyApp({
  api: {
    apiVersion: ApiVersion.October23,
    restResources: require('@shopify/shopify-api/rest/admin/2023-10'),
  },
  auth: {
    path: '/api/auth',
    callbackPath: '/api/auth/callback',
  },
  webhooks: {
    path: '/api/webhooks',
  },
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: 'app_store',
  isEmbeddedApp: true,
});

async function createServer() {
  await nextApp.prepare();
  
  const app = express();
  
  // Apply Shopify middleware
  app.use(shopify.cspHeaders());
  app.use('/api/*', shopify.validateAuthenticatedSession());

  // API Routes
  
  // Get dashboard data
  app.get('/api/dashboard', async (req, res) => {
    try {
      const session = res.locals.shopify.session;
      const client = new shopify.clients.Rest({ session });
      
      // Get orders from last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const orders = await client.get({
        path: 'orders',
        query: {
          status: 'any',
          created_at_min: thirtyDaysAgo.toISOString(),
          limit: 250
        }
      });

      // Get store settings for COGS
      const storeSettings = await prisma.storeSettings.findUnique({
        where: { shop: session.shop }
      });

      // Calculate metrics
      const dashboardData = calculateDashboardMetrics(orders.body.orders, storeSettings);
      
      res.json(dashboardData);
    } catch (error) {
      console.error('Dashboard API error:', error);
      res.status(500).json({ error: 'Failed to fetch dashboard data' });
    }
  });

  // Save store settings (COGS, etc.)
  app.post('/api/settings', express.json(), async (req, res) => {
    try {
      const session = res.locals.shopify.session;
      const { defaultCOGSPercentage, customCOGS } = req.body;
      
      const settings = await prisma.storeSettings.upsert({
        where: { shop: session.shop },
        update: {
          defaultCOGSPercentage,
          customCOGS: customCOGS || {}
        },
        create: {
          shop: session.shop,
          defaultCOGSPercentage,
          customCOGS: customCOGS || {}
        }
      });
      
      res.json(settings);
    } catch (error) {
      console.error('Settings API error:', error);
      res.status(500).json({ error: 'Failed to save settings' });
    }
  });

  // Get ad spend data
  app.get('/api/ad-spend', async (req, res) => {
    try {
      const session = res.locals.shopify.session;
      const { startDate, endDate } = req.query;
      
      // Get stored ad account credentials
      const adAccounts = await prisma.adAccount.findMany({
        where: { shop: session.shop }
      });
      
      let totalAdSpend = 0;
      const adSpendData = [];
      
      // Fetch Meta Ads data
      for (const account of adAccounts.filter(a => a.platform === 'meta')) {
        const metaSpend = await fetchMetaAdSpend(account.accountId, account.accessToken, startDate, endDate);
        totalAdSpend += metaSpend.total;
        adSpendData.push({ platform: 'Meta', ...metaSpend });
      }
      
      // Fetch Google Ads data
      for (const account of adAccounts.filter(a => a.platform === 'google')) {
        const googleSpend = await fetchGoogleAdSpend(account.accountId, account.accessToken, startDate, endDate);
        totalAdSpend += googleSpend.total;
        adSpendData.push({ platform: 'Google', ...googleSpend });
      }
      
      res.json({ totalAdSpend, breakdown: adSpendData });
    } catch (error) {
      console.error('Ad spend API error:', error);
      res.status(500).json({ error: 'Failed to fetch ad spend data' });
    }
  });

  // Upload COGS CSV
  const multer = require('multer');
  const csv = require('csv-parse');
  const upload = multer({ dest: 'uploads/' });
  
  app.post('/api/upload-cogs', upload.single('cogsFile'), async (req, res) => {
    try {
      const session = res.locals.shopify.session;
      const fs = require('fs');
      
      // Parse CSV
      const csvData = fs.readFileSync(req.file.path);
      const records = await new Promise((resolve, reject) => {
        csv.parse(csvData, { columns: true }, (err, output) => {
          if (err) reject(err);
          else resolve(output);
        });
      });
      
      // Process COGS data
      const customCOGS = {};
      records.forEach(row => {
        const sku = row.SKU || row.sku || row.Sku;
        const cogs = parseFloat(row.COGS || row.cogs || row.Cogs);
        if (sku && !isNaN(cogs)) {
          customCOGS[sku] = cogs;
        }
      });
      
      // Save to database
      await prisma.storeSettings.upsert({
        where: { shop: session.shop },
        update: { customCOGS },
        create: { shop: session.shop, customCOGS }
      });
      
      // Clean up file
      fs.unlinkSync(req.file.path);
      
      res.json({ success: true, itemsProcessed: Object.keys(customCOGS).length });
    } catch (error) {
      console.error('COGS upload error:', error);
      res.status(500).json({ error: 'Failed to process COGS file' });
    }
  });

  // Webhook handlers
  app.use('/api/webhooks', shopify.processWebhooks({
    ORDERS_CREATE: {
      deliveryMethod: 'http',
      callbackUrl: '/api/webhooks/orders/create',
      callback: async (topic, shop, body, webhookId) => {
        console.log('New order received:', body.id);
        // Trigger real-time update if needed
      }
    },
    ORDERS_UPDATED: {
      deliveryMethod: 'http',
      callbackUrl: '/api/webhooks/orders/update',
      callback: async (topic, shop, body, webhookId) => {
        console.log('Order updated:', body.id);
      }
    }
  }));

  // Shopify auth routes
  app.use('/api/auth', shopify.auth.begin());
  app.use('/api/auth/callback', shopify.auth.callback(), shopify.redirectToShopifyOrAppRoot());

  // App installation
  app.get('/api/auth/toplevel', shopify.auth.begin());
  app.get('/api/auth/toplevel/callback', shopify.auth.callback(), (req, res) => {
    res.redirect(`/?shop=${req.query.shop}&host=${req.query.host}`);
  });

  // Serve Next.js pages
  app.get('*', (req, res) => {
    return handle(req, res);
  });

  app.listen(PORT, () => {
    console.log(`Doughboard app listening on port ${PORT}`);
  });
}

// Helper functions
function calculateDashboardMetrics(orders, storeSettings) {
  let totalRevenue = 0;
  let totalCOGS = 0;
  let newCustomerRevenue = 0;
  let returningCustomerRevenue = 0;
  const customerEmails = new Set();
  
  orders.forEach(order => {
    const revenue = parseFloat(order.total_price);
    totalRevenue += revenue;
    
    // Calculate COGS
    let orderCOGS = 0;
    order.line_items.forEach(item => {
      const sku = item.sku;
      const quantity = item.quantity;
      const price = parseFloat(item.price);
      
      let unitCOGS = 0;
      if (storeSettings?.customCOGS?.[sku]) {
        unitCOGS = storeSettings.customCOGS[sku];
      } else if (storeSettings?.defaultCOGSPercentage) {
        unitCOGS = price * (storeSettings.defaultCOGSPercentage / 100);
      }
      
      orderCOGS += unitCOGS * quantity;
    });
    
    totalCOGS += orderCOGS;
    
    // Track customer type
    const email = order.email;
    if (email) {
      if (customerEmails.has(email)) {
        returningCustomerRevenue += revenue;
      } else {
        newCustomerRevenue += revenue;
        customerEmails.add(email);
      }
    }
  });
  
  return {
    totalRevenue,
    totalCOGS,
    grossProfit: totalRevenue - totalCOGS,
    newCustomerRevenue,
    returningCustomerRevenue,
    orderCount: orders.length,
    averageOrderValue: orders.length > 0 ? totalRevenue / orders.length : 0
  };
}

async function fetchMetaAdSpend(accountId, accessToken, startDate, endDate) {
  // Implementation for Meta Ads API
  try {
    const axios = require('axios');
    const response = await axios.get(`https://graph.facebook.com/v18.0/${accountId}/insights`, {
      params: {
        access_token: accessToken,
        fields: 'spend',
        time_range: JSON.stringify({
          since: startDate,
          until: endDate
        })
      }
    });
    
    const total = response.data.data.reduce((sum, day) => sum + parseFloat(day.spend), 0);
    return { total, daily: response.data.data };
  } catch (error) {
    console.error('Meta Ads API error:', error);
    return { total: 0, daily: [] };
  }
}

async function fetchGoogleAdSpend(accountId, accessToken, startDate, endDate) {
  // Implementation for Google Ads API
  try {
    // Google Ads API implementation would go here
    // This is a placeholder - actual implementation requires Google Ads API client
    return { total: 0, daily: [] };
  } catch (error) {
    console.error('Google Ads API error:', error);
    return { total: 0, daily: [] };
  }
}

createServer().catch(console.error);
