import { z } from 'zod';

// Сопоставление объекта EstiMat с проектом и получателем PayHub (админ).
export const payhubProjectMapSchema = z.object({
  payhubProjectId: z.number().int().positive().nullable(),
  payhubContractorId: z.number().int().positive().nullable(),
});
export type PayhubProjectMapInput = z.infer<typeof payhubProjectMapSchema>;

// Глобальная настройка «Отправитель РП» (app_settings.payhub_rp_sender).
export const payhubSenderSchema = z.object({
  contractorId: z.number().int().positive(),
  name: z.string().max(300).nullish(),
  inn: z.string().max(20).nullish(),
});
export type PayhubSenderInput = z.infer<typeof payhubSenderSchema>;
