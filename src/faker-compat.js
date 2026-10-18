// @farcaster/core 0.20.0 builds a few fixture objects as the module loads and
// still calls the Faker 7 API. Keep its fixture initialization working while
// the scoped dependency override uses a patched Faker release.
import { faker } from '@faker-js/faker/locale/en';

faker.datatype.number = (options = {}) => faker.number.int(options);
faker.datatype.datetime = ({ min = new Date(0), max = new Date() } = {}) => faker.date.between({ from: min, to: max });
faker.random = { alphaNumeric: (length) => faker.string.alphanumeric({ length }) };

export { faker };
