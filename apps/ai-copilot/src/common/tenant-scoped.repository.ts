import type {
  DeepPartial,
  FindManyOptions,
  FindOneOptions,
  FindOptionsWhere,
  Repository,
} from 'typeorm';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Structural tenant isolation at the TypeORM repository layer.
 *
 * Wraps a Repository<T> so that tenant_id (camelCased `tenantId` on the
 * entity) is overwritten on every operation that crosses the public surface
 * — callers cannot escape the filter via where-clause forgery, save-payload
 * forgery, or update-payload forgery.
 *
 * The wrapped Repository is held in a true ECMAScript private field (#repo);
 * `(instance as any).repo` is `undefined` and `Object.getOwnPropertyDescriptor`
 * returns `undefined` for it. Object.keys(instance) is empty. A determined
 * caller using `Reflect`/private-name access can still get in — this class
 * prevents *accidental* exposure, not airtight sandboxing.
 *
 * Methods covered in CP1.3: find, findOne, findOneBy, findAndCount, count,
 * exists, save (single entity), update, delete. createQueryBuilder is
 * deliberately *not* exposed — see W1_SESSION_LOG.md deferred-work notes.
 */
export class TenantScopedRepository<T extends { tenantId?: string }> {
  readonly #repo: Repository<T>;
  readonly #tenantId: string;

  constructor(repo: Repository<T>, tenantId: string) {
    if (typeof tenantId !== 'string' || !UUID_REGEX.test(tenantId)) {
      throw new Error(
        `TenantScopedRepository: tenantId must be a UUID string; got ${JSON.stringify(tenantId)}`,
      );
    }
    this.#repo = repo;
    this.#tenantId = tenantId;
  }

  #scopeWhere(
    where?: FindOptionsWhere<T> | FindOptionsWhere<T>[],
  ): FindOptionsWhere<T> | FindOptionsWhere<T>[] {
    const tenant = this.#tenantId;
    if (Array.isArray(where)) {
      return where.map((w) => ({ ...(w as object), tenantId: tenant })) as FindOptionsWhere<T>[];
    }
    return { ...((where as object) ?? {}), tenantId: tenant } as FindOptionsWhere<T>;
  }

  find(options?: FindManyOptions<T>): Promise<T[]> {
    return this.#repo.find({ ...(options ?? {}), where: this.#scopeWhere(options?.where) });
  }

  findOne(options: FindOneOptions<T>): Promise<T | null> {
    return this.#repo.findOne({ ...options, where: this.#scopeWhere(options.where) });
  }

  findOneBy(where: FindOptionsWhere<T>): Promise<T | null> {
    return this.#repo.findOneBy(this.#scopeWhere(where) as FindOptionsWhere<T>);
  }

  findAndCount(options?: FindManyOptions<T>): Promise<[T[], number]> {
    return this.#repo.findAndCount({
      ...(options ?? {}),
      where: this.#scopeWhere(options?.where),
    });
  }

  count(options?: FindManyOptions<T>): Promise<number> {
    return this.#repo.count({ ...(options ?? {}), where: this.#scopeWhere(options?.where) });
  }

  exists(options?: FindManyOptions<T>): Promise<boolean> {
    return this.#repo.exists({ ...(options ?? {}), where: this.#scopeWhere(options?.where) });
  }

  save(entity: DeepPartial<T>): Promise<T> {
    const scoped = { ...(entity as object), tenantId: this.#tenantId } as DeepPartial<T>;
    return this.#repo.save(scoped);
  }

  async update(
    criteria: FindOptionsWhere<T>,
    partialEntity: DeepPartial<T>,
  ): Promise<{ affected: number }> {
    const { tenantId: _stripped, ...rest } = partialEntity as Record<string, unknown>;
    const result = await this.#repo.update(
      this.#scopeWhere(criteria) as FindOptionsWhere<T>,
      rest as any,
    );
    return { affected: result.affected ?? 0 };
  }

  async delete(criteria: FindOptionsWhere<T>): Promise<{ affected: number }> {
    const result = await this.#repo.delete(this.#scopeWhere(criteria) as FindOptionsWhere<T>);
    return { affected: result.affected ?? 0 };
  }
}
