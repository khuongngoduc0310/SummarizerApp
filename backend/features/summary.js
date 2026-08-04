const { truncateSegments } = require('../tokenEstimator');
const { SUMMARY_SCHEMA, resolveLlmConfig, parseSummaryText, SummaryFormatError } = require('../llmConfig');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SYSTEM_PROMPT = `You are a meeting assistant that produces concise, structured summaries.
Focus on key discussed topics, decisions made, and follow-up action items.
Output ONLY valid JSON — no markdown, no commentary, no code fences — with these keys:
- executive: A brief paragraph of the meeting's essence.
- actions: An array of strings representing specific tasks to be done.
- questions: A string listing any unresolved questions or pending points.
- raw: The full detailed markdown summary.`;

function createSummaryFeature({ prisma, getOpenAI, getAnthropic }) {
  const openAIFactory = getOpenAI;
  const anthropicFactory = getAnthropic;

  return async function summaryRoute(req, res) {
    const { id: meetingId } = req.params;
    const { userId, llmConfig } = req.body;
    const { minutes } = req.query;

    if (!UUID_RE.test(meetingId)) return res.status(400).json({ error: 'Invalid meeting ID format' });
    if (typeof userId !== 'string' || userId.length === 0 || userId.length > 200) {
      return res.status(400).json({ error: 'userId must be a non-empty string' });
    }
    let resolvedLlmConfig;
    try {
      resolvedLlmConfig = resolveLlmConfig(llmConfig);
    } catch (error) {
      return res.status(error.statusCode || 400).json({ error: error.message });
    }

    try {
      const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
      if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

      const sessionStart = meeting.sessionStartedAt || meeting.startedAt;

      const whereClause = {
        transcript: { meetingId: meetingId },
        sessionStartedAt: sessionStart
      };

      let summaryType = 'full';
      let timeRangeStart = null;
      let timeRangeEnd = null;

      if (minutes) {
        const mins = parseInt(minutes, 10);
        if (!isNaN(mins) && mins > 0) {
          const cutoff = new Date(Date.now() - mins * 60 * 1000);
          whereClause.createdAt = { gte: sessionStart > cutoff ? sessionStart : cutoff };
          summaryType = 'rolling';
          timeRangeStart = (cutoff.getTime() - (meeting.startedAt?.getTime() || 0)) / 1000;
          timeRangeEnd = (Date.now() - (meeting.startedAt?.getTime() || 0)) / 1000;
        }
      }

      const segments = await prisma.transcriptSegment.findMany({
        where: whereClause,
        include: {
          transcript: {
            include: {
              owner: true
            }
          }
        },
        orderBy: { start: 'asc' }
      });

      if (segments.length === 0) {
        return res.status(400).json({ error: 'No transcript segments found to summarize in this session.' });
      }

      const { transcript: fullTranscript, droppedCount } = truncateSegments(segments);

      const { provider, model, apiKey } = resolvedLlmConfig;
      let summaryText = "";
      let usage = null;

      if (provider === 'openai') {
        const openai = openAIFactory({ apiKey });
        const response = await openai.responses.create({
          model,
          input: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: fullTranscript }
          ],
          max_output_tokens: 8192,
          text: {
            format: {
              type: 'json_schema',
              name: 'meeting_summary',
              strict: true,
              schema: SUMMARY_SCHEMA
            }
          }
        });
        if (response.status === 'incomplete') {
          throw new SummaryFormatError('The OpenAI response was incomplete.');
        }
        summaryText = response.output_text;
        usage = response.usage;
      } else if (provider === 'anthropic') {
        const anthropic = anthropicFactory({ apiKey });
        const response = await anthropic.messages.create({
          model,
          max_tokens: 8192,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: fullTranscript }],
          output_config: {
            format: { type: 'json_schema', schema: SUMMARY_SCHEMA }
          }
        });
        summaryText = response.content.find((block) => block.type === 'text')?.text;
        usage = response.usage;
      } else if (provider === 'deepseek') {
        const openai = openAIFactory({ apiKey, baseURL: 'https://api.deepseek.com' });
        const response = await openai.chat.completions.create({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: fullTranscript }
          ],
          max_tokens: 8192,
          response_format: { type: "json_object" }
        });
        summaryText = response.choices[0]?.message?.content;
        usage = response.usage;
      }

      if (usage) {
        console.log(`Summary LLM usage:`, JSON.stringify(usage));
      }

      const { parsed: parsedSummary, cleaned } = parseSummaryText(summaryText);

      const transcript = segments[0].transcript;

      await prisma.summary.create({
        data: {
          meetingId: meetingId,
          transcriptId: transcript?.id,
          requestedById: userId,
          model,
          provider: provider,
          summaryText: cleaned,
          type: summaryType,
          timeRangeStart: timeRangeStart,
          timeRangeEnd: timeRangeEnd
        }
      });

      res.json({
        ...parsedSummary,
        _meta: { type: summaryType, segmentCount: segments.length, droppedCount, provider, model }
      });
    } catch (error) {
      console.error('Error generating summary:', error);
      if (error instanceof SummaryFormatError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(502).json({ error: 'Summary generation failed. Check the API key, model access, and provider status.' });
    }
  };
}

module.exports = { createSummaryFeature };
