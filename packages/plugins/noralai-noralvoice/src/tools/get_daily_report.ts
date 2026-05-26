/**
 * `noralvoice:get_daily_report` tool handler.
 *
 * Phase 9C — Tier 2 read tool (worker tier).
 * Fetches the daily activity report (call counts, costs, per-workflow breakdown).
 * `date` defaults server-side to today when omitted.
 */

import {
  type DailyReport,
  type NoralVoiceClientConfig,
  getDailyReport,
} from "../noralvoice-client.js";

export interface GetDailyReportParams {
  date?: string;
}

export interface GetDailyReportResult {
  content: string;
  data: DailyReport;
}

export async function executeGetDailyReport(
  config: NoralVoiceClientConfig,
  params: GetDailyReportParams,
): Promise<GetDailyReportResult> {
  const report = await getDailyReport(config, { date: params.date });
  const callSummary =
    report.totalCalls !== undefined
      ? `${report.totalCalls} calls (${report.completedCalls ?? "?"} completed)`
      : "call data unavailable";
  return {
    content: `Daily report for ${report.date || "today"}: ${callSummary}.`,
    data: report,
  };
}
