import { Injectable } from '@nestjs/common';
import { AiRuntimeService } from '../ai-providers/ai-runtime.service';

export interface AiParsedRequisition {
  title: string;
  description?: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  lines: Array<{
    description: string;
    quantity: number;
    unitOfMeasure: string;
    unitPrice: number;
    glAccount?: string;
  }>;
  suggestedVendor?: string;
  neededBy?: string;
  notes?: string;
}

@Injectable()
export class AiRequisitionService {
  constructor(private readonly aiRuntime: AiRuntimeService) {}

  async parseFromText(organizationId: string, text: string): Promise<AiParsedRequisition> {
    try {
      const content = await this.aiRuntime.generateText(
        organizationId,
        `You are a procurement assistant. Parse the following purchase request and extract structured data.

IMPORTANT: Respond with ONLY a valid JSON object, no explanations or markdown.

The JSON must have this exact shape:
{
  "title": "short title for the requisition",
  "description": "detailed description or null",
  "priority": "low|normal|high|urgent",
  "lines": [
    {
      "description": "item description",
      "quantity": number,
      "unitOfMeasure": "each|box|kg|liter|hour|license|unit",
      "unitPrice": estimated_price_or_0,
      "glAccount": "gl code if mentioned or null"
    }
  ],
  "suggestedVendor": "vendor name if mentioned or null",
  "neededBy": "ISO date string if mentioned or null",
  "notes": "any other relevant notes or null"
}

Purchase request text:
${text}`,
        1024,
      );
      if (!content) return this.ruleBasedParse(text);

      // Extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return this.ruleBasedParse(text);

      const parsed = JSON.parse(jsonMatch[0]) as AiParsedRequisition;

      // Validate and sanitize
      return {
        title: parsed.title || 'New Requisition',
        description: parsed.description || undefined,
        priority: (['low', 'normal', 'high', 'urgent'].includes(parsed.priority ?? '') ? parsed.priority : 'normal') as any,
        lines: (parsed.lines ?? []).map((l: any) => ({
          description: l.description || 'Item',
          quantity: Math.max(0.01, Number(l.quantity) || 1),
          unitOfMeasure: l.unitOfMeasure || 'each',
          unitPrice: Math.max(0, Number(l.unitPrice) || 0),
          glAccount: l.glAccount || undefined,
        })),
        suggestedVendor: parsed.suggestedVendor || undefined,
        neededBy: parsed.neededBy || undefined,
        notes: parsed.notes || undefined,
      };
    } catch {
      return this.ruleBasedParse(text);
    }
  }

  private ruleBasedParse(text: string): AiParsedRequisition {
    // Simple rule-based fallback parser
    const lines = text.split('\n').filter((l) => l.trim());
    const title = lines[0]?.trim().replace(/^(i need|please order|order|buy|purchase)\s+/i, '') || 'New Requisition';

    const priorityMatch = text.match(/\b(urgent|asap|high priority|low priority|normal)\b/i);
    const priority = priorityMatch
      ? (priorityMatch[1].toLowerCase().includes('urgent') || priorityMatch[1].toLowerCase().includes('asap') ? 'urgent' :
         priorityMatch[1].toLowerCase().includes('high') ? 'high' :
         priorityMatch[1].toLowerCase().includes('low') ? 'low' : 'normal')
      : 'normal';

    const qtyMatch = text.match(/\b(\d+)\s+(units?|boxes?|kg|liters?|licenses?|pcs?|pieces?)\b/i);
    const qty = qtyMatch ? Number(qtyMatch[1]) : 1;
    const uom = qtyMatch ? qtyMatch[2].replace(/s$/, '').toLowerCase() : 'each';

    const priceMatch = text.match(/\$[\s]*([\d,]+(?:\.\d{2})?)/);
    const unitPrice = priceMatch ? parseFloat(priceMatch[1].replace(',', '')) : 0;

    const dateMatch = text.match(/by\s+((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,\s*\d{4})?|\d{4}-\d{2}-\d{2})/i);

    return {
      title: title.slice(0, 255),
      description: text.length > 50 ? text : undefined,
      priority: priority as any,
      lines: [{
        description: title.slice(0, 500),
        quantity: qty,
        unitOfMeasure: uom,
        unitPrice,
      }],
      neededBy: dateMatch ? dateMatch[1] : undefined,
      notes: 'Parsed from plain text. Please review and adjust line items.',
    };
  }
}
