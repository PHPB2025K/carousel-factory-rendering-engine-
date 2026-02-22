const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3100;
const SLIDE_WIDTH = 1080;
const SLIDE_HEIGHT = 1350;
const DEVICE_SCALE_FACTOR = 2;

let browser;

async function getBrowser() {
  if (!browser || !browser.isConnected()) {
    const launchOptions = {
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    };
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }
    browser = await puppeteer.launch(launchOptions);
  }
  return browser;
}

function loadTemplate(layoutStyle) {
  const templatePath = path.join(__dirname, 'templates', `${layoutStyle}.html`);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template not found: ${layoutStyle}`);
  }
  return fs.readFileSync(templatePath, 'utf-8');
}

function injectVariables(html, data) {
  let result = html;

  // Replace all {{variable}} placeholders
  const vars = {
    heading: data.heading || '',
    body_text: data.body_text || '',
    background: data.background || '#FFFFFF',
    background_color: data.background_color || data.background || '#FFFFFF',
    text_color_primary: data.text_color_primary || '#1A1A1A',
    text_color_secondary: data.text_color_secondary || '#666666',
    accent_color: data.accent_color || '#3B82F6',
    font_heading: data.font_heading || 'Inter',
    font_body: data.font_body || 'Inter',
    heading_size: data.heading_size || '2.5rem',
    body_size: data.body_size || '1.2rem',
    border_radius: data.border_radius || '12px',
    shadow: data.shadow || 'none',
    spacing_unit: data.spacing_unit || '24px',
    image_url: data.image_url || '',
    logo_url: data.logo_url || '',
    overlay_opacity: data.overlay_opacity != null ? data.overlay_opacity : 0.5,
    text_alignment: data.text_alignment || 'center',
    slide_number: data.slide_number || '',
    total_slides: data.total_slides || '',
    profile_handle: data.profile_handle || '',
    label_text: data.label_text || '',
    swipe_text: data.swipe_text || '',
    cta_text: data.cta_text || 'Saiba Mais',
  };

  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
  }

  // Handle conditional blocks: {{#if variable}}...{{/if}}
  result = result.replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (match, varName, content) => {
    return vars[varName] ? content : '';
  });

  return result;
}

async function renderSlide(data) {
  const layoutStyle = data.layout_style || 'centered';
  const template = loadTemplate(layoutStyle);
  const html = injectVariables(template, data);

  const b = await getBrowser();
  const page = await b.newPage();

  await page.setViewport({
    width: SLIDE_WIDTH,
    height: SLIDE_HEIGHT,
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
  });

  await page.setContent(html, { waitUntil: 'networkidle0', timeout: 15000 });

  // Wait for fonts to load
  await page.evaluate(() => document.fonts.ready);

  const screenshot = await page.screenshot({
    type: 'png',
    encoding: 'base64',
  });

  await page.close();
  return screenshot;
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '0.1.0', templates: getAvailableTemplates() });
});

function getAvailableTemplates() {
  const templatesDir = path.join(__dirname, 'templates');
  if (!fs.existsSync(templatesDir)) return [];
  return fs.readdirSync(templatesDir)
    .filter(f => f.endsWith('.html'))
    .map(f => f.replace('.html', ''));
}

// Render single slide
app.post('/render-slide', async (req, res) => {
  try {
    const data = req.body;
    if (!data.layout_style) {
      return res.status(400).json({ error: 'layout_style is required' });
    }

    const base64 = await renderSlide(data);
    res.json({
      success: true,
      image: base64,
      format: 'png',
      width: SLIDE_WIDTH * DEVICE_SCALE_FACTOR,
      height: SLIDE_HEIGHT * DEVICE_SCALE_FACTOR,
    });
  } catch (err) {
    console.error('Render error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Render full carousel
app.post('/render-carousel', async (req, res) => {
  try {
    const { slides } = req.body;
    if (!Array.isArray(slides) || slides.length === 0) {
      return res.status(400).json({ error: 'slides array is required' });
    }

    const results = [];
    for (let i = 0; i < slides.length; i++) {
      const slide = { ...slides[i], slide_number: i + 1, total_slides: slides.length };
      const base64 = await renderSlide(slide);
      results.push({
        position: i + 1,
        image: base64,
        format: 'png',
      });
    }

    res.json({ success: true, slides: results });
  } catch (err) {
    console.error('Carousel render error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Rendering engine running on http://localhost:${PORT}`);
  console.log(`Available templates: ${getAvailableTemplates().join(', ')}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  if (browser) await browser.close();
  process.exit(0);
});
