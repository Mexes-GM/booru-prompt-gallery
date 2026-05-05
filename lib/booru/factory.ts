import { DanbooruProvider } from './providers/danbooru'
import { Rule34Provider } from './providers/rule34'
import { AibooruProvider } from './providers/aibooru'
import { E621Provider } from './providers/e621'
import { GelbooruProvider } from './providers/gelbooru'
import { IBooruProvider } from './types'

export class BooruFactory {
  static getProvider(type: 'danbooru' | 'rule34' | 'aibooru' | 'e621' | 'gelbooru'): IBooruProvider {
    switch (type) {
      case 'danbooru':
        return new DanbooruProvider()
      case 'rule34':
        return new Rule34Provider()
      case 'aibooru':
        return new AibooruProvider()
      case 'e621':
        return new E621Provider()
      case 'gelbooru':
        return new GelbooruProvider()
      default:
        throw new Error(`Unknown provider type: ${type}`)
    }
  }
}
