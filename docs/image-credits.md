# Product photograph credits

The six local photographs are representative examples for the six named demo products. They are not photographs of the synthetic suppliers, their goods, farms, vessels, handling conditions, or current inventory. Product facts and traceability remain in the listing records. Unknown/new listing titles keep the existing illustration fallback.

The application displays a “Representative image” label and descriptive image alt text. Public attribution is available at `/products/credits.html`. Source and license pages were checked on 5 November 2026. The [source manifest](image-credits-sources.json) records retrieved URLs, license metadata, output dimensions, byte sizes, and SHA-256 checksums.

| Local asset / demo product | Photographer and source | License |
| --- | --- | --- |
| `tomatoes.webp` — Vine-ripened tomatoes | Renee Comet, National Cancer Institute; [Tomato (1).jpg](https://commons.wikimedia.org/wiki/File:Tomato_(1).jpg) | Public domain, as recorded on the source page |
| `mangoes.webp` — Golden carabao mangoes | Obsidian Soul; [Carabao mangoes (Philippines).jpg](https://commons.wikimedia.org/wiki/File:Carabao_mangoes_(Philippines).jpg) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `rice.webp` — Premium jasmine rice | Takeaway; [2014 uncooked Thai jasmine rice.jpg](https://commons.wikimedia.org/wiki/File:2014_uncooked_Thai_jasmine_rice.jpg) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The adapted rice image remains under this license |
| `shrimp.webp` — Fresh whiteleg shrimp | Judgefloro; [2884Whiteleg shrimp in the Philippines textures 08.jpg](https://commons.wikimedia.org/wiki/File:2884Whiteleg_shrimp_in_the_Philippines_textures_08.jpg) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `tuna.webp` — Yellowfin tuna | William B. Folsom, NMFS / NOAA Photo Library; [Yellowfin tuna.jpg](https://commons.wikimedia.org/wiki/File:Yellowfin_tuna.jpg) | Public domain U.S. NOAA work, as recorded on the source page |
| `lettuce.webp` — Crisp romaine lettuce | Jeffery Martin; [Stack of romaine lettuce heads.jpg](https://commons.wikimedia.org/wiki/File:Stack_of_romaine_lettuce_heads.jpg) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |

All six files are served from `apps/web/public/products`. Each source was resized to 720 pixels wide, stripped of EXIF metadata, and compressed to WebP at quality 78 using the already installed Sharp dependency. The interface crops the photographs responsively with CSS. No generative edits, recoloring, background replacement, or source-stock claims were made. The rice source depicts Thai jasmine rice; its use illustrates the grain type and does not establish the demo listing's Philippine origin. The tuna source depicts yellowfin caught in North Carolina; it does not establish the demo vessel or catch location.

The six image files total **270,520 bytes** (about 264 KiB). Individual files range from 26,390 to 73,020 bytes. Images load lazily from the application itself; rendering makes no Wikimedia or other external image request. Attribution links are ordinary user-initiated navigation. No source photograph implies endorsement of HarvestLink.
