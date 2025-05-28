/*
    type TopicId = string;
    type NoteId = string;
    type NoteText = string;

    type Topic = {
        id: TopicId;
        name: string;
    };

    type Note = {
        id: NoteId;
        topicId: TopicId;
        date: Date;
        text: NoteText;
    };
*/

/*
    type EntityId = string;
    type EntityType = string;

    type CommonDataAccess = {
        create: <Entity>(entityType: EntityType, entity: Entity) => Promise<void>;
        edit: <Entity>(entityType: EntityType, id: EntityId, entity: Entity) => Promise<void>;
        delete: <Entity>(entityType: EntityType, id: EntityId) => Promise<void>;
        findOne: <Entity>(entityType: EntityType, id: EntityId) => Promise<Entity>;
        findAll: <Entity>(entityType: EntityType) => Promise<Entity[]>;
    };

    type Context<Params> = {
        commonDataAccess: CommonDataAccess;
        params: Params;
    };
*/

const createEntity =
    (entityType) =>
    async ({ commonDataAccess, params }) => {
        return commonDataAccess.create(entityType, params);
    };

const editEntity =
    (entityType) =>
    async ({ commonDataAccess, params }) => {
        return commonDataAccess.edit(entityType, params);
    };

const deleteEntity =
    (entityType) =>
    async ({ commonDataAccess, params: { id } }) => {
        return commonDataAccess.delete(entityType, id);
    };

const getEntity =
    (entityType) =>
    async ({ commonDataAccess, params: { id } }) => {
        return commonDataAccess.findOne(entityType, id);
    };

const getAllEntities =
    (entityType) =>
    async ({ commonDataAccess }) => {
        return commonDataAccess.findAll(entityType);
    };

const ENTITY_TYPE = {
    TOPIC: "TOPIC",
    NOTE: "NOTE",
}

const createTopic = ()
