/**
 * @license Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

/**
 * @fileoverview Audit a page to see if it does have resources that are blocking first paint
 */

'use strict';

const Audit = require('../audit');
const Node = require('../../lib/dependency-graph/node');
const ByteEfficiencyAudit = require('./byte-efficiency-audit');
const UnusedCSS = require('./unused-css-rules');
const WebInspector = require('../../lib/web-inspector');

// Because of the way we detect blocking stylesheets, asynchronously loaded
// CSS with link[rel=preload] and an onload handler (see https://github.com/filamentgroup/loadCSS)
// can be falsely flagged as blocking. Therefore, ignore stylesheets that loaded fast enough
// to possibly be non-blocking (and they have minimal impact anyway).
const MINIMUM_WASTED_MS = 50;

const keyByUrl = arr => arr.reduce((map, node) => {
  map[node.record && node.record.url] = node;
  return map;
}, {});

class RenderBlockingResources extends Audit {
  /**
   * @return {!AuditMeta}
   */
  static get meta() {
    return {
      name: 'render-blocking-resources',
      description: 'Eliminate render-blocking resources',
      informative: true,
      scoreDisplayMode: Audit.SCORING_MODES.NUMERIC,
      helpText: 'Resources are blocking the first paint of your page. Consider ' +
          'delivering critical JS/CSS inline and deferring all non-critical ' +
          'JS/styles. [Learn more](https://developers.google.com/web/tools/lighthouse/audits/blocking-resources).',
      requiredArtifacts: ['CSSUsage', 'URL', 'TagsBlockingFirstPaint', 'traces'],
    };
  }

  /**
   * @param {Artifacts} artifacts
   * @param {LH.Audit.Context} context
   */
  static async computeResults(artifacts, context) {
    const trace = artifacts.traces[Audit.DEFAULT_PASS];
    const devtoolsLog = artifacts.devtoolsLogs[Audit.DEFAULT_PASS];
    const simulatorData = {devtoolsLog, settings: context.settings};
    const traceOfTab = await artifacts.requestTraceOfTab(trace);
    const simulator = await artifacts.requestLoadSimulator(simulatorData);
    const wastedBytesMap = await RenderBlockingResources.computeWastedCSSBytes(artifacts, context);

    const metricSettings = {throttlingMethod: 'simulate'};
    const metricComputationData = {trace, devtoolsLog, simulator, settings: metricSettings};
    const fcpSimulation = await artifacts.requestFirstContentfulPaint(metricComputationData);
    const fcpTsInMs = traceOfTab.timestamps.firstContentfulPaint / 1000;

    const nodeTimingMap = fcpSimulation.optimisticEstimate.nodeTiming;
    const nodesByUrl = keyByUrl(Array.from(nodeTimingMap.keys()));

    const results = [];
    const deferredNodeIds = new Set();
    for (const resource of artifacts.TagsBlockingFirstPaint) {
      // Ignore any resources that finished after observed FCP (they're clearly not render-blocking)
      if (resource.endTime * 1000 > fcpTsInMs) continue;

      const node = nodesByUrl[resource.tag.url];
      const nodeTiming = nodeTimingMap.get(node);
      // TODO(phulce): beacon these occurences to Sentry to improve FCP graph
      if (!node) continue;

      // Mark this node and all it's dependents as deferrable
      // TODO(phulce): make this slightly more surgical
      // i.e. the referenced font asset won't become inlined just because you inline the CSS
      node.traverse(node => deferredNodeIds.add(node.id));

      const wastedMs = nodeTiming.endTime - nodeTiming.startTime;
      if (wastedMs < MINIMUM_WASTED_MS) continue;

      results.push({
        url: resource.tag.url,
        totalBytes: resource.transferSize,
        wastedMs,
      });
    }

    if (!results.length) {
      return {results, wastedMs: 0};
    }

    const wastedMs = RenderBlockingResources.estimateSavingsFromInlining(
      simulator,
      fcpSimulation.optimisticGraph,
      deferredNodeIds,
      wastedBytesMap
    );

    return {results, wastedMs};
  }

  /**
   * @param {Simulator} simulator
   * @param {Node} fcpGraph
   * @param {Set<string>} deferredIds
   * @param {Map<string, number>} wastedBytesMap
   * @return {number}
   */
  static estimateSavingsFromInlining(simulator, fcpGraph, deferredIds, wastedBytesMap) {
    const originalEstimate = simulator.simulate(fcpGraph).timeInMs;

    let totalChildNetworkBytes = 0;
    const graphWithoutChildren = fcpGraph.cloneWithRelationships(node => {
      const willDefer = deferredIds.has(node.id);
      if (willDefer && node.type === Node.TYPES.NETWORK &&
          node.record._resourceType === WebInspector.resourceTypes.Stylesheet) {
        const wastedBytes = wastedBytesMap.get(node.record.url) || 0;
        totalChildNetworkBytes += node.record._transferSize - wastedBytes;
      }

      // Include all nodes that couldn't be deferred
      return !willDefer;
    });

    graphWithoutChildren.record._transferSize += totalChildNetworkBytes;
    const estimateAfterInlineA = simulator.simulate(graphWithoutChildren);
    const estimateAfterInline = estimateAfterInlineA.timeInMs;
    graphWithoutChildren.record._transferSize -= totalChildNetworkBytes;
    return Math.max(originalEstimate - estimateAfterInline, 0);
  }

  /**
   * @param {!Artifacts} artifacts
   * @param {LH.Audit.Context} context
   * @return {Map<string, number>}
   */
  static async computeWastedCSSBytes(artifacts, context) {
    const wastedBytesByUrl = new Map();
    try {
      const results = await UnusedCSS.audit(artifacts, context);
      for (const item of results.details.items) {
        wastedBytesByUrl.set(item.url, item.wastedBytes);
      }
    } catch (_) {}

    return wastedBytesByUrl;
  }

  /**
   * @param {!Artifacts} artifacts
   * @param {LH.Audit.Context} context
   * @return {AuditResult}
   */
  static async audit(artifacts, context) {
    const {results, wastedMs} = await RenderBlockingResources.computeResults(artifacts, context);

    let displayValue = '';
    if (results.length > 1) {
      displayValue = `${results.length} resources delayed first paint by ${wastedMs}ms`;
    } else if (results.length === 1) {
      displayValue = `${results.length} resource delayed first paint by ${wastedMs}ms`;
    }

    const headings = [
      {key: 'url', itemType: 'url', text: 'URL'},
      {key: 'totalBytes', itemType: 'bytes', displayUnit: 'kb', granularity: 0.01,
        text: 'Size (KB)'},
      {key: 'wastedMs', itemType: 'ms', text: 'Download Time (ms)', granularity: 1},
    ];

    const summary = {wastedMs};
    const details = Audit.makeTableDetails(headings, results, summary);

    return {
      displayValue,
      score: ByteEfficiencyAudit.scoreForWastedMs(wastedMs),
      rawValue: wastedMs,
      details,
    };
  }
}

module.exports = RenderBlockingResources;
