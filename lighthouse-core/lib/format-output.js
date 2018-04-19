/**
 * @license Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

const ReportGenerator = require('../report/v2/report-generator');

/**
 * Converts the results to a CSV formatted string
 * Each row describes the result of 1 audit with
 *  - the name of the category the audit belongs to
 *  - the name of the audit
 *  - a description of the audit
 *  - the score type that is used for the audit
 *  - the score value of the audit
 *
 * @param {LH.Result} lhr
 * @returns {string}
 */
function toCSVReport(lhr) {
  // To keep things "official" we follow the CSV specification (RFC4180)
  // The document describes how to deal with escaping commas and quotes etc.
  const CRLF = '\r\n';
  const separator = ',';
  /** @param {string} value @returns {string} */
  const escape = (value) => `"${value.replace(/"/g, '""')}"`;


  // Possible TODO: tightly couple headers and row values
  const header = ['category', 'name', 'title', 'type', 'score'];
  const table = lhr.reportCategories.map(category => {
    return category.audits.map(catAudit => {
      const audit = lhr.audits[catAudit.id];
      return [category.name, audit.name, audit.description, audit.scoreDisplayMode, audit.score]
        .map(value => value.toString())
        .map(escape);
    });
  });

  // @ts-ignore TS loses track of type Array
  const flattedTable = [].concat(...table);
  return [header, ...flattedTable].map(row => row.join(separator)).join(CRLF);
}

/**
 * Creates the results output in a format based on the `mode`.
 * @param {LH.Result} lhr
 * @param {string} outputMode
 * @return {string}
 */
function createOutput(lhr, outputMode) {
  // HTML report.
  if (outputMode === 'html') {
    return new ReportGenerator().generateReportHtml(lhr);
  }
  // JSON report.
  if (outputMode === 'json') {
    return JSON.stringify(lhr, null, 2);
  }
  // CSV report.
  if (outputMode === 'csv') {
    return toCSVReport(lhr);
  }

  throw new Error('Invalid output mode: ' + outputMode);
}

module.exports = {
  createOutput,
};
