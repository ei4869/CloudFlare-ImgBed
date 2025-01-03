export async function onRequest(context) {
    // Contents of context object
    const {
      request, // same as existing Worker API
      env, // same as existing Worker API
      params, // if filename includes [id] or [[path]]
      waitUntil, // same as ctx.waitUntil in existing Worker API
      next, // used for middleware or to fetch assets
      data, // arbitrary space for passing data between middlewares
    } = context;
    const requestUrl = new URL(request.url);

    // 检查是否启用了随机图功能
    if (env.AllowRandom != "true") {
        return new Response(JSON.stringify({ error: "Random is disabled" }), { status: 403 });
    }

    // 检查是否配置了KV数据库
    if (typeof env.img_url == "undefined" || env.img_url == null || env.img_url == "") {
        return new Response('Error: Please configure KV database', { status: 500 });
    }

    // 从params中读取返回的文件类型
    let fileType = requestUrl.searchParams.get('content');
    if (fileType == null) {
        fileType = ['image'];
    } else {
        fileType = fileType.split(',');
    }

    // 调用randomFileList接口，读取KV数据库中的所有记录
    let allRecords = await getRandomFileList(env, requestUrl);

    // 筛选出符合fileType要求的记录
    allRecords = allRecords.filter(item => { return fileType.some(type => item.FileType.includes(type)) });


    if (allRecords.length == 0) {
        return new Response(JSON.stringify({}), { status: 200 });
    } else {
        const randomIndex = Math.floor(Math.random() * allRecords.length);
        const randomKey = allRecords[randomIndex];
        const randomPath = '/file/' + randomKey.name;
        let randomUrl = randomPath;

        const randomType = requestUrl.searchParams.get('type');
        const resType = requestUrl.searchParams.get('form');
        
        // if param 'type' is set to 'url', return the full URL
        if (randomType == 'url') {
            randomUrl = requestUrl.origin + randomPath;
        }

        // if param 'type' is set to 'img', return the image
        if (randomType == 'img') {
            // Return an image response
            randomUrl = requestUrl.origin + randomPath;
            let contentType = 'image/jpeg';
            return new Response(await fetch(randomUrl).then(res => {
                contentType = res.headers.get('content-type');
                return res.blob();
            }), {
                headers: contentType ? { 'Content-Type': contentType } : { 'Content-Type': 'image/jpeg' },
                status: 200
            });
        }
        
        if (resType == 'text') {
            return new Response(randomUrl, { status: 200 });
        } else {
            return new Response(JSON.stringify({ url: randomUrl }), { status: 200 });
        }
    }
}

async function getRandomFileList(env, url) {
    // 检查缓存中是否有记录，有则直接返回
    const cache = caches.default;
    const cacheRes = await cache.match(`${url.origin}/api/randomFileList`);
    if (cacheRes) {
        console.log("Cache hit: Returning cached data.");
        return JSON.parse(await cacheRes.text());
    }

    console.log("Cache miss: Fetching data from KV database.");
    let allRecords = [];
    let cursor = null;

    do {
        const records = await env.img_url.list({
            limit: 1000,
            cursor,
        });

        console.log("Fetched records from KV:", records.keys.map(item => item.name)); // 输出获取到的记录名称

        // 筛选逻辑：
        // 1. 除去以 manage@ 开头的记录
        let filteredRecords = records.keys.filter(item => !item.name.startsWith("manage@"));
        console.log("After removing 'manage@':", filteredRecords.map(item => item.name));

        // 2. 保留 fileType 为 image 或 video 的记录
        filteredRecords = filteredRecords.filter(item => 
            item.metadata?.FileType?.includes("image") || item.metadata?.FileType?.includes("video")
        );
        console.log("After filtering by FileType:", filteredRecords.map(item => item.name));

        // 3. 仅保留 name 中包含 'kon' 的记录
        filteredRecords = filteredRecords.filter(item => item.name.includes("kon"));
        console.log("After filtering by 'kon':", filteredRecords.map(item => item.name));

        allRecords.push(...filteredRecords);
        cursor = records.cursor;
    } while (cursor);

    // 调试输出：最终筛选的记录
    console.log("Final filtered records:", allRecords.map(item => item.name));

    // 仅保留记录的 name 和 metadata.FileType 字段
    allRecords = allRecords.map(item => {
        return {
            name: item.name,
            FileType: item.metadata?.FileType
        };
    });

    // 缓存结果，缓存时间为24小时
    await cache.put(`${url.origin}/api/randomFileList`, new Response(JSON.stringify(allRecords), {
        headers: {
            "Content-Type": "application/json",
        }
    }), {
        expirationTtl: 24 * 60 * 60
    });

    console.log("Data cached successfully.");
    return allRecords;
}
