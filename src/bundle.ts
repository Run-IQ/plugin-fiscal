import { FiscalPlugin } from './FiscalPlugin.js';
import { fiscalDescriptor } from './descriptor.js';
import { JsonLogicEvaluator } from '@run-iq/dsl-jsonlogic';
import type { PluginBundle } from '@run-iq/plugin-sdk';

const bundle: PluginBundle = {
  plugin: new FiscalPlugin(),
  descriptor: fiscalDescriptor,
  dsls: [new JsonLogicEvaluator()],
};

export default bundle;
