import { z } from 'zod';

export const REQUIRED_APPROVAL_NODE_ID = '__required_approval__';

export const WORKFLOW_ASSIGNMENT_STATUSES = [
  'waiting',
  'pending',
  'approved',
  'rejected',
  'skipped',
] as const;

export type WorkflowAssignmentStatus = (typeof WORKFLOW_ASSIGNMENT_STATUSES)[number];

export const workflowNodeIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((value) => value !== REQUIRED_APPROVAL_NODE_ID, 'This workflow node ID is reserved');

export type WorkflowCondition =
  | {
      operator: 'AND' | 'OR';
      conditions: WorkflowCondition[];
    }
  | {
      field: string;
      operator: '>=' | '>' | '<=' | '<' | '==' | 'eq' | '!=' | 'neq';
      value: string | number | boolean | null;
    };

export const workflowConditionSchema: z.ZodType<WorkflowCondition> = z.lazy(() =>
  z.union([
    z.object({
      operator: z.enum(['AND', 'OR']),
      conditions: z.array(workflowConditionSchema).min(1),
    }),
    z.object({
      field: z.string().trim().min(1).max(100),
      operator: z.enum(['>=', '>', '<=', '<', '==', 'eq', '!=', 'neq']),
      value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
    }),
  ]),
);

export const workflowDecimalAmountSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)(\.\d+)?$/, 'Amount must be a non-negative decimal string');

export const approverResolverSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('user'),
    userId: z.string().uuid(),
    spendLimitBaseAmount: workflowDecimalAmountSchema.optional(),
  }),
  z.object({
    type: z.literal('role'),
    role: z.string().trim().min(1).max(50),
    scope: z.enum(['global', 'department', 'project', 'entity']).default('global'),
    spendLimitBaseAmount: workflowDecimalAmountSchema.optional(),
  }),
  z.object({
    type: z.literal('manager_chain'),
    maxLevels: z.number().int().positive().max(20).default(10),
    spendLimitBaseAmount: workflowDecimalAmountSchema.optional(),
  }),
]);

export type ApproverResolver = z.infer<typeof approverResolverSchema>;

export const separationOfDutiesSchema = z.object({
  enabled: z.boolean().default(false),
  exclude: z.array(z.enum(['requester', 'submitter', 'invoice_creator', 'po_creator'])).default([]),
  fallbackResolvers: z.array(approverResolverSchema).default([]),
});

export type SeparationOfDuties = z.infer<typeof separationOfDutiesSchema>;

const nodeBaseShape = {
  id: workflowNodeIdSchema,
  name: z.string().trim().min(1).max(120),
  disabled: z.boolean().default(false),
};

export const triggerNodeSchema = z.object({
  ...nodeBaseShape,
  type: z.literal('trigger'),
  config: z.object({
    event: z.enum(['requisition_submitted', 'invoice_submitted', 'po_change_submitted']),
  }),
});

export const conditionNodeSchema = z.object({
  ...nodeBaseShape,
  type: z.literal('condition'),
  config: z.object({
    mode: z.enum(['first_true', 'all_true']).default('first_true'),
  }),
});

export const matchCheckNodeSchema = z.object({
  ...nodeBaseShape,
  type: z.literal('match_check'),
  config: z.object({}),
});

export const budgetCheckNodeSchema = z.object({
  ...nodeBaseShape,
  type: z.literal('budget_check'),
  config: z.object({
    policy: z.literal('organization_default').default('organization_default'),
  }),
});

const quorumSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('all') }),
  z.object({ type: z.literal('majority') }),
  z.object({ type: z.literal('count'), count: z.number().int().positive() }),
]);

export const approverGroupNodeSchema = z.object({
  ...nodeBaseShape,
  type: z.literal('approver_group'),
  config: z.object({
    execution: z.enum(['serial', 'parallel']).default('serial'),
    resolvers: z.array(approverResolverSchema),
    quorum: quorumSchema.default({ type: 'all' }),
    separationOfDuties: separationOfDutiesSchema.default({
      enabled: false,
      exclude: [],
      fallbackResolvers: [],
    }),
  }),
});

export const resolverNodeSchema = z.object({
  ...nodeBaseShape,
  type: z.literal('resolver'),
  config: z.object({
    resolvers: z.array(approverResolverSchema),
    separationOfDuties: separationOfDutiesSchema.default({
      enabled: false,
      exclude: [],
      fallbackResolvers: [],
    }),
  }),
});

export const delegationNodeSchema = z.object({
  ...nodeBaseShape,
  type: z.literal('delegation'),
  config: z.object({
    mode: z.enum(['standing', 'per_instance', 'both']).default('both'),
  }),
});

const escalationActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('notify') }),
  z.object({ type: z.literal('auto_approve') }),
  z.object({ type: z.literal('auto_reject') }),
  z.object({
    type: z.literal('reassign'),
    resolvers: z.array(approverResolverSchema).min(1),
  }),
]);

export const escalationTimerNodeSchema = z.object({
  ...nodeBaseShape,
  type: z.literal('escalation_timer'),
  config: z.object({
    parentNodeId: workflowNodeIdSchema,
    slaHours: z.number().positive(),
    warningPercent: z.number().min(1).max(99).default(75),
    action: escalationActionSchema,
  }),
});

export const collectFormNodeSchema = z.object({
  ...nodeBaseShape,
  type: z.literal('collect_form'),
  config: z.object({
    fields: z
      .array(
        z.object({
          key: z.string().trim().min(1).max(100),
          label: z.string().trim().min(1).max(120),
          type: z.enum(['text', 'number', 'boolean', 'date']),
          required: z.boolean().default(false),
        }),
      )
      .min(1)
      .refine((fields) => new Set(fields.map((field) => field.key)).size === fields.length, {
        message: 'Field keys must be unique',
      }),
  }),
});

export const notifyNodeSchema = z.object({
  ...nodeBaseShape,
  type: z.literal('notify'),
  config: z.object({
    channels: z.array(z.enum(['email', 'slack', 'in_app'])).min(1),
    recipients: z.array(approverResolverSchema).min(1),
    message: z.string().trim().min(1).max(2_000),
  }),
});

export const autoApproveNodeSchema = z.object({
  ...nodeBaseShape,
  type: z.literal('auto_approve'),
  config: z.object({
    reason: z.string().trim().min(1).max(500),
  }),
});

export const rejectNodeSchema = z.object({
  ...nodeBaseShape,
  type: z.literal('reject'),
  config: z.object({
    reasonRequired: z.boolean().default(true),
    defaultReason: z.string().trim().min(1).max(500).optional(),
  }),
});

export const approvedNodeSchema = z.object({
  ...nodeBaseShape,
  type: z.literal('approved'),
  config: z.object({}),
});

export const workflowNodeSchema = z.discriminatedUnion('type', [
  triggerNodeSchema,
  conditionNodeSchema,
  matchCheckNodeSchema,
  budgetCheckNodeSchema,
  approverGroupNodeSchema,
  resolverNodeSchema,
  delegationNodeSchema,
  escalationTimerNodeSchema,
  collectFormNodeSchema,
  notifyNodeSchema,
  autoApproveNodeSchema,
  rejectNodeSchema,
  approvedNodeSchema,
]);

export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export type WorkflowNodeType = WorkflowNode['type'];

export const WORKFLOW_NODE_PORTS = {
  trigger: { inputs: [], outputs: ['out'] },
  condition: { inputs: ['in'], outputs: ['branch', 'default'] },
  match_check: { inputs: ['in'], outputs: ['within_tolerance', 'exception'] },
  budget_check: { inputs: ['in'], outputs: ['available', 'breach'] },
  approver_group: { inputs: ['in'], outputs: ['out'] },
  resolver: { inputs: ['in'], outputs: ['out'] },
  delegation: { inputs: ['in'], outputs: ['out'] },
  escalation_timer: { inputs: ['in'], outputs: ['out'] },
  collect_form: { inputs: ['in'], outputs: ['out'] },
  notify: { inputs: ['in'], outputs: ['out'] },
  auto_approve: { inputs: ['in'], outputs: [] },
  reject: { inputs: ['in'], outputs: [] },
  approved: { inputs: ['in'], outputs: [] },
} as const satisfies Record<
  WorkflowNodeType,
  { inputs: readonly string[]; outputs: readonly string[] }
>;

export const APPROVAL_NODE_TYPES = ['approver_group', 'resolver'] as const;
export const TERMINAL_NODE_TYPES = ['auto_approve', 'reject', 'approved'] as const;

export type ApprovalNodeType = (typeof APPROVAL_NODE_TYPES)[number];
export type ApprovalNode = Extract<WorkflowNode, { type: ApprovalNodeType }>;

export function isApprovalNode(node: WorkflowNode): node is ApprovalNode {
  return (APPROVAL_NODE_TYPES as readonly WorkflowNodeType[]).includes(node.type);
}
