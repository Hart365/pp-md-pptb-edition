import { afterEach, describe, expect, it, vi } from 'vitest';
import { XMLParser } from 'fast-xml-parser';
import { fetchXmlQuery } from './dataverseClient';

const parser = new XMLParser({ ignoreAttributes: false, parseAttributeValue: false });
const annotationKey = '@Microsoft.Dynamics.CRM.fetchxmlpagingcookie';
const moreRecordsKey = '@Microsoft.Dynamics.CRM.morerecords';

function installFetch(response: (xml: string) => Promise<DataverseAPI.FetchXmlResult>) {
  const fetch = vi.fn(response);
  vi.stubGlobal('window', { dataverseAPI: { fetchXmlQuery: fetch } });
  return fetch;
}

describe('FetchXML paging', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(['raw', 'web-api'] as const)('uses the inner cookie for %s responses without changing the query', async (format) => {
    const cookie = '<cookie page="1"><webresourceid last="{ABC}" first="{DEF}" /><name last="a&amp;b%25" first="start" /></cookie>';
    const annotation = format === 'raw' ? cookie
      : `<cookie pagenumber="2" pagingcookie="${encodeURIComponent(encodeURIComponent(cookie))}" istracking="False" />`;
    const fetch = installFetch(async (xml) => {
      const root = parser.parse(xml).fetch;
      expect(root.entity).toEqual({
        attribute: [{ '@_name': 'webresourceid' }, { '@_name': 'name' }],
        order: { '@_attribute': 'webresourceid' },
        '@_name': 'webresource',
      });
      if (root['@_page'] === '1') {
        expect(root['@_paging-cookie']).toBeUndefined();
        return { value: [{ webresourceid: 'first' }], [annotationKey]: annotation, [moreRecordsKey]: true };
      }
      expect(root['@_page']).toBe('2');
      expect(root['@_paging-cookie']).toBe(cookie);
      expect(root['@_count']).toBe('5000');
      return { value: [{ webresourceid: 'last' }], [annotationKey]: annotation, [moreRecordsKey]: false };
    });

    const rows = await fetchXmlQuery(`<fetch distinct="true"><entity name="webresource">
      <attribute name="webresourceid" /><attribute name="name" /><order attribute="webresourceid" />
    </entity></fetch>`);
    expect(rows).toEqual([{ webresourceid: 'first' }, { webresourceid: 'last' }]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('reports a malformed encoded cookie before sending another request', async () => {
    const fetch = installFetch(async () => ({
      value: [{}], [annotationKey]: '<cookie pagingcookie="%invalid" />',
    }));
    await expect(fetchXmlQuery('<fetch><entity name="webresource" /></fetch>'))
      .rejects.toThrow('invalid URL-encoded FetchXML paging cookie');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not silently return an incomplete inventory when a required cookie is absent', async () => {
    installFetch(async () => ({ value: [{}], [moreRecordsKey]: true }));
    await expect(fetchXmlQuery('<fetch><entity name="webresource" /></fetch>'))
      .rejects.toThrow('inventory is incomplete');
  });

  it('checks the next page when a full page has no continuation annotations', async () => {
    const fetch = installFetch(async (xml) => ({
      value: parser.parse(xml).fetch['@_page'] === '1'
        ? Array.from({ length: 5000 }, (_, id) => ({ id })) : [{ id: 5000 }],
    }));
    const rows = await fetchXmlQuery('<fetch><entity name="webresource" /></fetch>');
    expect(rows).toHaveLength(5001);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
