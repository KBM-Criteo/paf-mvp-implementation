import { anythingButAssets, WebSiteConfig } from '../website-config';
import { VHostApp } from '@core/express/express-apps';

const { name, host, cdnHost, pafNodeHost }: WebSiteConfig = {
  name: 'POF publisher',
  host: 'www.pofdemopublisher.com',
  cdnHost: 'cdn.pofdemopublisher.com',
  pafNodeHost: 'cmp.pofdemopublisher.com',
};

export const pofPublisherWebSiteApp = new VHostApp(name, host);

pofPublisherWebSiteApp.expressApp.get(anythingButAssets, (req, res) => {
  const view = 'publisher/index';

  res.render(view, {
    title: name,
    cdnHost,
    pafNodeHost,
    useCmpUI: true,
  });
});

export const pofPublisherCdnApp = new VHostApp(name, cdnHost);
