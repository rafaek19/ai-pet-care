import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());

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
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );

    const data = await response.json();
    if (!response.ok)
      return res.status(response.status).json({ error: data?.error?.message || 'Gemini API error' });

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
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `You are a helpful pet care assistant for Angeles Animal Care Hospital.\n\n${question}`,
            }],
          }],
        }),
      }
    );

    const data = await response.json();
    if (!response.ok)
      return res.status(response.status).json({ error: data?.error?.message || 'Gemini API error' });

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return res.status(500).json({ error: 'No response from AI model' });

    res.json({ content: [{ text }] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));