/** /v1/images/* routes: generations + edits (reference-image generation). */
import { handleImagesEdits, handleImagesGenerations } from '../../../openai/images.js';
import { requireMethod } from '../../http/router.js';

export function createImagesRoutes() {
  return [
    {
      path: '/v1/images/generations',
      handler: async (ctx) => {
        requireMethod(ctx, ['POST'], 'POST');
        ctx.log.endpoint = 'POST /v1/images/generations';
        await handleImagesGenerations(ctx.req, ctx.res, ctx);
      }
    },
    {
      path: '/v1/images/edits',
      handler: async (ctx) => {
        requireMethod(ctx, ['POST'], 'POST');
        ctx.log.endpoint = 'POST /v1/images/edits';
        await handleImagesEdits(ctx.req, ctx.res, ctx);
      }
    }
  ];
}

export default { createImagesRoutes };
