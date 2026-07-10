import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());

// retry helper for gemini calls — retries on 429 (rate limit) with backoff
async function callgemini(model, body, retries = 2) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(url, {
      method: 'post',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (response.status !== 429 || attempt === retries) {
      return response;
    }

    const waitms = 1000 * Math.pow(2, attempt);
    console.warn(`gemini 429 rate limit, retrying in ${waitms}ms (attempt ${attempt + 1}/${retries})`);
    await new Promise(r => setTimeout(r, waitms));
  }
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/pre-assess', async (req, res) => {
  const { petName, petType, petAge, symptoms, additionalNotes } = req.body;

  if (!symptoms || symptoms.trim().length < 5)
    return res.status(400).json({ error: "Please describe your pet's symptoms." });

  if (!process.env.GEMINI_API_KEY)
    return res.status(500).json({ error: 'Gemini API key not configured' });

  const prompt = `You are a veterinary triage assistant for Angeles Animal Care Hospital.

Pet: ${petName || 'Unknown'} (${petType || 'Unknown'}, ${petAge || 'Unknown'})
Symptoms: ${symptoms}
Notes: ${additionalNotes || 'None'}

Respond ONLY with valid JSON (no markdown, no backticks):
{
  "conditions": ["condition1", "condition2"],
  "urgency": "Emergency|High|Moderate|Low",
  "urgencyReason": "explanation",
  "recommendedService": "General Check-up|Emergency Care|Vaccination|Dental Care|Surgery Consultation|Dermatology|Laboratory/Diagnostics|Grooming|Follow-up",
  "summary": "2-3 sentence summary",
  "warningSigns": ["sign1", "sign2"],
  "homeCareTips": ["tip1", "tip2"],
  "appointment_notes": "brief notes"
}`;

  try {
     const response = await callgemini('gemini-3.1-flash-lite', {
      contents: [{ parts: [{ text: prompt }] }],
    });

   const rawBody = await response.text();
    let data;
    try {
      data = JSON.parse(rawBody);
    } catch {
      console.error('Non-JSON response from Gemini:', response.status, rawBody);
      return res.status(502).json({ error: `Gemini returned an unreadable response (status ${response.status})` });
    }
    if (!response.ok) {
      const msg = response.status === 429
        ? 'Our AI is receiving a lot of requests right now. Please wait a moment and try again.'
        : (data?.error?.message || 'Gemini API error');
      return res.status(response.status).json({ error: msg });
    }

    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) return res.status(500).json({ error: 'No response from AI' });

    const cleaned = rawText.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    res.json(parsed);
  } catch (err) {
    console.error('Pre-assess error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/chat', async (req, res) => {
  const { question } = req.body;
  if (!question) return res.status(400).json({ error: 'Question is required' });
  if (!process.env.GEMINI_API_KEY)
    return res.status(500).json({ error: 'Gemini API key not configured' });

  try {
     const response = await callgemini('gemini-3.1-flash-lite', {
      contents: [{
        parts: [{
          text: `You are a helpful pet care assistant for Angeles Animal Care Hospital.\n\n${question}`,
        }],
      }],
    });

   const rawBody = await response.text();
    let data;
    try {
      data = JSON.parse(rawBody);
    } catch {
      console.error('Non-JSON response from Gemini:', response.status, rawBody);
      return res.status(502).json({ error: `Gemini returned an unreadable response (status ${response.status})` });
    }
    if (!response.ok) {
      const msg = response.status === 429
        ? 'Our AI is receiving a lot of requests right now. Please wait a moment and try again.'
        : (data?.error?.message || 'Gemini API error');
      return res.status(response.status).json({ error: msg });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return res.status(500).json({ error: 'No response from AI model' });

    res.json({ content: [{ text }] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
