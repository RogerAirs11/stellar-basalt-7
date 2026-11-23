import { createViewContext } from './viewContext.mjs';
import { createRegistryViews } from './views/registry.mjs';
import { createNetworkViews } from './views/network.mjs';
import { createMarketplaceViews } from './views/marketplace.mjs';
import { createBreedingViews } from './views/breeding.mjs';
import { createWorkflowsViews } from './views/workflows.mjs';
import { createBusinessViews } from './views/business.mjs';
import { createTrustViews } from './views/trust.mjs';
/** Compose independent demo domains without sharing any production frontend tree. */
export function createViews(data, state, lang, filters = {}) {
    const context = createViewContext(data, state, lang, filters);
    const registry = createRegistryViews(context);
    return { ...registry, saved: () => registry.horses(true),
        ...createNetworkViews(context),
        ...createMarketplaceViews({...context,ancestry:registry.ancestry}),
        ...createBreedingViews(context),
        ...createWorkflowsViews(context),
        ...createBusinessViews(context),
        ...createTrustViews(context),
        notFound: context.notFound, requestDialog: context.requestDialog, t: context.t, label: context.label, targetName: context.targetName };
}
