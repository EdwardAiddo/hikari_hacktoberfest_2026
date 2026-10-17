// OWNER: person B (branch feature/detect-scanner)
// Browser + axe part of Tool 1. Replace the stub body; keep the exported signature.
import type { PageResult } from "./types.js";
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

export interface ScanOptions {
  /** where to save the screenshot; omit to skip it */
  screenshotPath?: string;
}



/**
 * Open `url` in headless Chromium, run axe-core, return normalized violations.
 *
 * Reminders:
 *  - axe needs `browser.newContext()` then `context.newPage()` (not `browser.newPage()`)
 *  - one Violation per failing node (axe groups nodes under a rule: flatten them)
 *  - keep nodes[].any[].data for color-contrast
 *  - sort by impact (critical first) and close the browser even on errors
 */
export async function scanPage(url: string): Promise<PageResult> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle' });

    // Esegui axe-core
    const results = await new AxeBuilder({ page }).analyze();

    const normalizedViolations: Violation[] = [];

    // Appiattisci i risultati come richiesto dal contratto
    for (const rule of results.violations) {
      for (const node of rule.nodes) {
        
        // Estrai data (es. fgColor, bgColor, contrastRatio) da node.any
        let ruleData: Record<string, unknown> | undefined = undefined;
        const checksWithData = node.any.filter(check => check.data !== undefined);
        if (checksWithData.length > 0) {
          // Prende i dati del primo check che li possiede (tipico per color-contrast)
          ruleData = checksWithData[0].data as Record<string, unknown>;
        }

        normalizedViolations.push({
          ruleId: rule.id,
          impact: (node.impact || rule.impact || null) as Impact | null,
          help: rule.help,
          html: node.html,
          target: node.target,
          failureSummary: node.failureSummary || 'Nessun sommario disponibile',
          data: ruleData
        });
      }
    }

    // Ordina per impatto (critical per primo)
    const impactScores: Record<string, number> = { 
      critical: 4, 
      serious: 3, 
      moderate: 2, 
      minor: 1 
    };
    
    normalizedViolations.sort((a, b) => {
      const scoreA = (a.impact && impactScores[a.impact as string]) ? impactScores[a.impact as string] : 0;
      const scoreB = (b.impact && impactScores[b.impact as string]) ? impactScores[b.impact as string] : 0;
      return scoreB - scoreA;
    });

    return {
      url,
      violations: normalizedViolations
    };

  } catch (error) {
    console.error(`Errore durante la scansione di ${url}:`, error);
    throw error;
  } finally {
    await browser.close();
  }
}
