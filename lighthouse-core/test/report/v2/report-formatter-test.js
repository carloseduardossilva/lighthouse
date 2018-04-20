/**
 * @license Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

/* eslint-env mocha */
const formatReport = require('../../../report/v2/report-formatter').formatReport;
const assert = require('assert');
const fs = require('fs');
const sampleResults = require('../../../../lighthouse-core/test/results/sample_v2.json');
const csvValidator = require('csv-validator');

describe('formatReport', () => {
  it('creates JSON for results', () => {
    const jsonOutput = formatReport(sampleResults, 'json');
    assert.doesNotThrow(_ => JSON.parse(jsonOutput));
  });

  it('creates HTML for results', () => {
    const htmlOutput = formatReport(sampleResults, 'html');
    assert.ok(/<!doctype/gim.test(htmlOutput));
    assert.ok(/<html lang="en"/gim.test(htmlOutput));
  });

  it('creates CSV for results', async () => {
    const path = './.results-as-csv.csv';
    const headers = {
      category: '',
      name: '',
      title: '',
      type: '',
      score: 42,
    };

    const csvOutput = formatReport(sampleResults, 'csv');
    fs.writeFileSync(path, csvOutput);

    try {
      await csvValidator(path, headers);
    } catch (err) {
      assert.fail('CSV parser error:\n' + err.join('\n'));
    } finally {
      fs.unlinkSync(path);
    }
  });

  it('writes extended info', () => {
    const htmlOutput = formatReport(sampleResults, 'html');
    const outputCheck = new RegExp('dobetterweb/dbw_tester.css', 'i');
    assert.ok(outputCheck.test(htmlOutput));
  });
});
