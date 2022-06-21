import {
  createSeed,
  getIdsAndPreferences,
  getNewId,
  refreshIdsAndPreferences,
  RefreshResult,
  signPreferences,
} from '../../src/lib/paf-lib';
import { CookiesHelpers, getFakeIdentifier, getFakeIdentifiers, getFakePreferences } from '../helpers/cookies';
import { Cookies } from '@core/cookies';
import { PafStatus } from '../../src/enums/status.enum';
import {
  Error,
  GetIdsPrefsResponse,
  Identifier,
  IdsAndPreferences,
  PostSeedResponse,
} from '@core/model/generated-model';
import fetch from 'jest-fetch-mock';
import { isBrowserKnownToSupport3PC } from '@core/user-agent';
import { MockedFunction } from 'ts-jest';

jest.mock('@core/user-agent', () => ({ isBrowserKnownToSupport3PC: jest.fn() }));
jest.mock('ua-parser-js', () => () => ({ getBrowser: () => 'JEST-DOM' }));

const pafClientNodeHost = 'http://localhost';

afterEach(() => {
  // cleaning up the mess left behind the previous test
  fetch.resetMocks();
});

describe('Function getIdsAndPreferences', () => {
  beforeEach(() => {
    CookiesHelpers.clearPafCookies();
  });

  test('should return undefined with no cookies', () => {
    expect(getIdsAndPreferences()).toBeUndefined();
  });

  test('should return value stored in cookies', () => {
    const fakeId = 'FAKE_TEST_ID';
    const testConsent = false;

    CookiesHelpers.mockIdentifiers(fakeId);
    CookiesHelpers.mockPreferences(testConsent);
    CookiesHelpers.mockRefreshTime();
    expect(getIdsAndPreferences()).toEqual({
      preferences: getFakePreferences(testConsent),
      identifiers: getFakeIdentifiers(fakeId),
    });
  });

  test('should return undefined if refreshTime is missing', () => {
    const fakeId = 'FAKE_TEST_ID';
    const testConsent = false;

    CookiesHelpers.mockIdentifiers(fakeId);
    CookiesHelpers.mockPreferences(testConsent);

    expect(getIdsAndPreferences()).toBeUndefined();
  });

  test('should return undefined if user is not participating', () => {
    CookiesHelpers.setCookies(Cookies.preferences, PafStatus.NOT_PARTICIPATING);
    CookiesHelpers.setCookies(Cookies.identifiers, PafStatus.NOT_PARTICIPATING);
    expect(getIdsAndPreferences()).toBeUndefined();
  });

  test('should return undefined if redirect is needed', () => {
    CookiesHelpers.setCookies(Cookies.preferences, PafStatus.REDIRECT_NEEDED);
    CookiesHelpers.setCookies(Cookies.identifiers, PafStatus.REDIRECT_NEEDED);
    expect(getIdsAndPreferences()).toBeUndefined();
  });
});

describe('Function getNewId', () => {
  const FAKE_ID = 'A-B-TEST-ID';

  test('should return new ID', async () => {
    const identifiers = getFakeIdentifiers(FAKE_ID);
    fetch.mockResponses(
      'operatorURLGet', // Call to the proxy to get the operator URL
      JSON.stringify(<GetIdsPrefsResponse>{ body: { identifiers } }) // Actual call to the operator
    );
    try {
      const identifier: Identifier = await getNewId({ proxyHostName: pafClientNodeHost });
      expect(identifier.value).toBe(FAKE_ID);
      expect(fetch.mock.calls.length).toEqual(2);
    } catch (error) {
      throw new Error(error);
    }
  });
});

// FIXME test updateIdsAndPreferences
/*
describe('Function writeIdsAndPref', () => {
  const idAndPreferences: IdsAndPreferences = {
    preferences: getFakePreferences(true),
    identifiers: getFakeIdentifiers(),
  };

  describe('without 3PC', () => {
    const redirectUrl = new URL('http://redirect-url.fake');
    const redirectMock = jest.fn();
    const realLocation = location;

    beforeEach(() => {
      delete global.location;
      global.location = {
        replace: redirectMock,
      } as unknown as Location;
    });

    afterEach(() => {
      redirectMock.mockClear();
      global.location = realLocation;
    });

    test('should redirect to operator', async () => {
      await writeIdsAndPref({ proxyHostName, redirectUrl }, idAndPreferences);

      expect(redirectMock.mock.calls.length).toBe(1);
      // FIXME: redirect Url is changed inside writeIdsAndPref
      expect(redirectMock.mock.calls[0][0]).toBe(redirectUrl.toString());
    });
  });
});

 */

describe('Function refreshIdsAndPreferences', () => {
  const realLocation = location;

  describe('with data in the URI', () => {
    const historySpy = jest.spyOn(global.history, 'pushState');
    const uriData = 'TEST-STRING';
    const identifier = getFakeIdentifiers()[0];
    const preferences = getFakePreferences(true);

    beforeAll(() => {
      delete global.location;
      global.location = {
        search: `?paf=${uriData}`,
        href: 'fake-href?foo=42&paf=TO_BE_REMOVED&baz=bar',
      } as unknown as Location;
      global.PAFUI = {
        showNotification: jest.fn(),
      };
    });

    afterEach(() => {
      historySpy.mockClear();
    });

    afterAll(() => {
      global.location = realLocation;
    });

    test('should clean paf parameter in the URI', async () => {
      fetch.mockResponseOnce(JSON.stringify({ body: { identifiers: [] } }));

      await refreshIdsAndPreferences({
        proxyHostName: pafClientNodeHost,
        triggerRedirectIfNeeded: true,
      });

      expect(historySpy).toBeCalledWith(null, '', 'fake-href?foo=42&baz=bar');
    });

    test('should verify uriData', async () => {
      // Just one call to the proxy to verify data
      fetch.mockResponseOnce(JSON.stringify({ body: { identifiers: [] } }));

      await refreshIdsAndPreferences({
        proxyHostName: pafClientNodeHost,
        triggerRedirectIfNeeded: true,
      });

      expect(fetch.mock.calls[0][1].body).toBe(uriData);
    });

    test('should throw an error if empty response received', async () => {
      fetch.mockResponseOnce('null');
      await expect(
        refreshIdsAndPreferences({
          proxyHostName: pafClientNodeHost,
          triggerRedirectIfNeeded: true,
        })
      ).rejects.toBe('Verification failed');
    });

    test('should save NOT_PARTICIPATING, if no preferences received', async () => {
      fetch.mockResponseOnce(
        JSON.stringify({
          body: {
            identifiers: [],
            preferences: undefined,
          },
        })
      );
      await refreshIdsAndPreferences({
        proxyHostName: pafClientNodeHost,
        triggerRedirectIfNeeded: true,
      });

      expect(document.cookie).toContain(`${Cookies.identifiers}=NOT_PARTICIPATING`);
      expect(document.cookie).toContain(`${Cookies.preferences}=NOT_PARTICIPATING`);
    });

    test('should save persistedIds to Cookies', async () => {
      fetch.mockResponseOnce(
        JSON.stringify({
          body: {
            identifiers: [identifier],
            preferences,
          },
        })
      );

      const result = await refreshIdsAndPreferences({
        proxyHostName: pafClientNodeHost,
        triggerRedirectIfNeeded: true,
      });

      expect(document.cookie).toContain(JSON.stringify(identifier));
      expect(document.cookie).toContain(JSON.stringify(preferences));

      expect(result).toEqual({
        status: PafStatus.PARTICIPATING,
        data: {
          identifiers: [identifier],
          preferences,
        },
      });
    });

    test('should display notification', async () => {
      fetch.mockResponseOnce(
        JSON.stringify({
          body: {
            identifiers: [identifier],
            preferences,
          },
        })
      );

      await refreshIdsAndPreferences({
        proxyHostName: pafClientNodeHost,
        triggerRedirectIfNeeded: true,
      });

      expect(global.PAFUI.showNotification).toBeCalledWith('PERSONALIZED');
    });
  });

  describe('when redirect needed', () => {
    const redirectMock = jest.fn();
    const realLocation = location;

    beforeAll(() => {
      delete global.location;
      global.location = {
        replace: redirectMock,
        href: 'http://localhost',
      } as unknown as Location;
      CookiesHelpers.setCookies(Cookies.identifiers, PafStatus.REDIRECT_NEEDED);
    });

    afterAll(() => {
      CookiesHelpers.clearPafCookies();
      global.location = realLocation;
    });

    test('should redirect', async () => {
      const result = await refreshIdsAndPreferences({
        proxyHostName: pafClientNodeHost,
        triggerRedirectIfNeeded: false,
      });

      expect(global.location.replace).not.toBeCalled();
      expect(result).toEqual({
        status: PafStatus.REDIRECT_NEEDED,
      });

      await refreshIdsAndPreferences({
        proxyHostName: pafClientNodeHost,
        triggerRedirectIfNeeded: true,
      });

      expect(redirectMock).toBeCalled();
    });
  });

  describe('when local cookies', () => {
    const fakeId = 'FAKE_IDENTIFIER';

    beforeAll(() => {
      CookiesHelpers.mockPreferences(true);
      CookiesHelpers.mockIdentifiers(fakeId);
      CookiesHelpers.mockRefreshTime();
    });

    afterAll(() => {
      CookiesHelpers.clearPafCookies();
    });

    test('should return cookies value', async () => {
      const result = await refreshIdsAndPreferences({
        proxyHostName: pafClientNodeHost,
        triggerRedirectIfNeeded: true,
      });

      expect(result).toEqual({
        status: PafStatus.PARTICIPATING,
        data: {
          identifiers: getFakeIdentifiers(fakeId),
          preferences: getFakePreferences(true),
        },
      });
    });
  });

  const cases = [
    {
      cachedCookies: false,
      message: 'no local cookies',
    },
    {
      cachedCookies: true,
      message: 'local cookies expired',
    },
  ];

  describe.each(cases)('when $message', (data) => {
    const fakeId = 'FAKE_IDENTIFIER';

    beforeAll(() => {
      global.PAFUI = {
        showNotification: jest.fn(),
      };

      if (data.cachedCookies) {
        CookiesHelpers.mockPreferences(true);
        CookiesHelpers.mockIdentifiers(fakeId);
        // Note: no refreshTime => ids and preferences must be considered expired
      }
    });

    afterAll(() => {
      CookiesHelpers.clearPafCookies();
    });

    describe('when browser is known to support 3PC', () => {
      beforeAll(() => {
        (isBrowserKnownToSupport3PC as MockedFunction<typeof isBrowserKnownToSupport3PC>).mockImplementation(
          () => true
        );
      });

      test('should return data from operator', async () => {
        fetch.mockResponses(
          'operatorURLGet', // Call to the proxy to get the operator URL
          JSON.stringify(<GetIdsPrefsResponse>{
            body: {
              identifiers: getFakeIdentifiers(),
              preferences: getFakePreferences(),
            },
          }) // Actual call to the operator
        );
        const result = await refreshIdsAndPreferences({
          proxyHostName: pafClientNodeHost,
          triggerRedirectIfNeeded: false,
        });

        expect(isBrowserKnownToSupport3PC).toHaveBeenCalled();
        expect(result).toEqual({
          status: PafStatus.PARTICIPATING,
          data: {
            identifiers: getFakeIdentifiers(),
            preferences: getFakePreferences(),
          },
        });
        expect(document.cookie).toContain(`${Cookies.identifiers}=${JSON.stringify(getFakeIdentifiers())}`);
        expect(document.cookie).toContain(`${Cookies.preferences}=${JSON.stringify(getFakePreferences())}`);

        CookiesHelpers.clearPafCookies();
      });

      describe("but browser doesn't actually support it", () => {
        beforeAll(() => {
          fetch.mockResponses(
            'operatorURLGet', // Call to the proxy to get the operator URL
            JSON.stringify(<GetIdsPrefsResponse>{
              body: {
                identifiers: [
                  {
                    ...getFakeIdentifier('0c7966db-9e6a-4060-be81-824a9ce671d3'),
                    persisted: false, // A newly generated ID
                  },
                ],
              },
            }), // Actual call to the operator
            'operatorURLCheck3PC', // Call to the proxy to get the operator URL
            JSON.stringify(<Error>{
              message: 'No 3PC supported',
            }) // Actual call to the operator
          );
        });

        test('should require redirect', async () => {
          const result = await refreshIdsAndPreferences({
            proxyHostName: pafClientNodeHost,
            triggerRedirectIfNeeded: false,
          });

          expect(isBrowserKnownToSupport3PC).toHaveBeenCalled();
          expect(result).toEqual({
            status: PafStatus.REDIRECT_NEEDED,
          });
          expect(document.cookie).toContain(`${Cookies.identifiers}="${PafStatus.REDIRECT_NEEDED}"`);
          expect(document.cookie).toContain(`${Cookies.preferences}="${PafStatus.REDIRECT_NEEDED}"`);

          CookiesHelpers.clearPafCookies();
        });
      });

      describe('when browser is known NOT to support 3PC', () => {
        const replaceMock = jest.fn();
        beforeAll(() => {
          (isBrowserKnownToSupport3PC as MockedFunction<typeof isBrowserKnownToSupport3PC>).mockImplementation(
            () => false
          );
          delete global.location;
          global.location = {
            replace: replaceMock,
            href: 'http://localhost/my-page.html?foo=bar',
          } as unknown as Location;
        });

        afterAll(() => {
          global.location = realLocation;
        });

        test('triggers redirect', async () => {
          await refreshIdsAndPreferences({
            proxyHostName: pafClientNodeHost,
            triggerRedirectIfNeeded: true,
          });

          expect(replaceMock).toHaveBeenCalled();
        });
      });
    });

    describe('when redirect has been deferred', () => {
      test('should return status "redirect needed"', async () => {
        CookiesHelpers.setCookies(Cookies.identifiers, PafStatus.REDIRECT_NEEDED);
        CookiesHelpers.setCookies(Cookies.preferences, PafStatus.REDIRECT_NEEDED);
        CookiesHelpers.mockRefreshTime();

        const result = await refreshIdsAndPreferences({
          proxyHostName: pafClientNodeHost,
          triggerRedirectIfNeeded: true,
        });

        expect(result).toEqual(<RefreshResult>{
          status: PafStatus.REDIRECT_NEEDED,
        });
      });
    });
  });
});

describe('Function signPreferences', () => {
  test('should return fetch response', async () => {
    const mockResponse = { body: 'response' };
    fetch.mockResponseOnce(JSON.stringify(mockResponse));
    const input = { unsignedPreferences: getFakePreferences(), identifiers: getFakeIdentifiers() };
    const result = await signPreferences({ proxyHostName: pafClientNodeHost }, input);
    expect(result).toEqual(mockResponse);
  });
});

describe('Function createSeed', () => {
  const transmission_ids = ['1234', '5678'];
  const idsAndPreferences: IdsAndPreferences = {
    preferences: getFakePreferences(true),
    identifiers: getFakeIdentifiers(),
  };
  const response: PostSeedResponse = {
    version: '0.1',
    transaction_ids: transmission_ids,
    publisher: pafClientNodeHost,
    source: {
      domain: 'proxyHostName',
      timestamp: 123454,
      signature: 'signature_value',
    },
  };

  beforeEach(() => {
    CookiesHelpers.clearPafCookies();
    CookiesHelpers.setIdsAndPreferences(idsAndPreferences);
    fetch.mockResponseOnce(JSON.stringify(response));
  });

  afterEach(() => {
    CookiesHelpers.clearPafCookies();
    fetch.resetMocks();
  });

  test('with empty transmission_ids', async () => {
    const seed = await createSeed({ proxyHostName: pafClientNodeHost }, []);
    expect(seed).toBeUndefined();
  });

  test('with no id and preferences', async () => {
    CookiesHelpers.clearPafCookies();
    const seed = await createSeed({ proxyHostName: pafClientNodeHost }, transmission_ids);
    expect(seed).toBeUndefined();
  });

  test('nominal path', async () => {
    const entry = await createSeed({ proxyHostName: pafClientNodeHost }, transmission_ids);
    expect(entry).toEqual({
      seed: response,
      idsAndPreferences,
    });
  });
});
